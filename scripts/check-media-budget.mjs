import { execFileSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const moduleFilePath = import.meta.url.startsWith("file:")
  ? fileURLToPath(import.meta.url)
  : null;
const defaultProjectRoot = moduleFilePath
  ? resolve(dirname(moduleFilePath), "..")
  : process.cwd();
const totalLimit = 8 * 1024 * 1024;
const desktopLimit = 2.5 * 1024 * 1024;
const mobileLimit = 1.75 * 1024 * 1024;
const posterLimit = 150 * 1024;
const posterName = "hero.webp";
const expectedVideos = [
  {
    codec: "av1",
    container: "webm",
    height: 720,
    name: "hero-1280.webm",
    profile: "Main",
    width: 1280,
  },
  {
    codec: "h264",
    container: "mp4",
    height: 720,
    level: 40,
    name: "hero-1280.mp4",
    profile: "High",
    width: 1280,
  },
  {
    codec: "av1",
    container: "webm",
    height: 540,
    name: "hero-960.webm",
    profile: "Main",
    width: 960,
  },
  {
    codec: "h264",
    container: "mp4",
    height: 540,
    level: 31,
    name: "hero-960.mp4",
    profile: "High",
    width: 960,
  },
];
const expectedVideoNames = expectedVideos.map(({ name }) => name);

function portablePath(parts, directory = false) {
  const path = parts.join(sep).split(sep).join("/");
  return directory ? `${path}/` : path;
}

async function collectEntries(directory, parts = []) {
  const currentDirectory = join(directory, ...parts);
  let directoryEntries;

  try {
    directoryEntries = await readdir(currentDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT" && parts.length === 0) {
      return [];
    }

    throw error;
  }

  const entries = [];
  for (const directoryEntry of directoryEntries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryParts = [...parts, directoryEntry.name];
    const absolutePath = join(directory, ...entryParts);
    const metadata = await lstat(absolutePath);

    if (directoryEntry.isSymbolicLink()) {
      entries.push({
        absolutePath,
        kind: "symlink",
        relativePath: portablePath(entryParts),
        size: metadata.size,
      });
      continue;
    }

    if (directoryEntry.isDirectory()) {
      entries.push({
        absolutePath,
        kind: "directory",
        relativePath: portablePath(entryParts, true),
        size: 0,
      });
      entries.push(...(await collectEntries(directory, entryParts)));
      continue;
    }

    entries.push({
      absolutePath,
      kind: directoryEntry.isFile() ? "file" : "other",
      relativePath: portablePath(entryParts),
      size: metadata.size,
    });
  }

  return entries;
}

export async function inspectMediaDirectory(
  directory,
  { expectedNames, mediaType },
) {
  const expected = new Set(expectedNames);
  const entries = await collectEntries(directory);
  const errors = [];

  for (const entry of entries) {
    if (entry.kind === "directory") {
      errors.push(`Unexpected ${mediaType} directory: ${entry.relativePath}`);
      continue;
    }

    if (entry.kind === "symlink") {
      errors.push(`Unexpected ${mediaType} symlink: ${entry.relativePath}`);
      continue;
    }

    if (entry.kind !== "file") {
      errors.push(`Unexpected ${mediaType} entry: ${entry.relativePath}`);
      continue;
    }

    if (!expected.has(entry.relativePath)) {
      errors.push(`Unexpected ${mediaType} file: ${entry.relativePath}`);
    }
  }

  const rootFiles = entries.filter(
    (entry) =>
      entry.kind === "file" && !entry.relativePath.includes("/"),
  );
  const rootFileNames = new Set(rootFiles.map(({ relativePath }) => relativePath));

  for (const expectedName of expectedNames) {
    if (!rootFileNames.has(expectedName)) {
      errors.push(`Missing media file: ${expectedName}`);
    }
  }

  return {
    entries,
    errors,
    rootFiles,
    totalBytes: entries
      .filter(({ kind }) => kind === "file")
      .reduce((total, { size }) => total + size, 0),
  };
}

function probe(
  filePath,
  fileName,
  errors,
  execFileImpl = execFileSync,
) {
  try {
    return JSON.parse(
      execFileImpl(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,codec_name,profile,width,height,pix_fmt,avg_frame_rate,r_frame_rate,duration,level:format=duration,format_name",
          "-of",
          "json",
          filePath,
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (error) {
    errors.push(`ffprobe failed for ${fileName}: ${error.message}`);
    return null;
  }
}

function rationalValue(value) {
  const parts = String(value).trim().split("/");
  if (parts.length > 2) {
    return Number.NaN;
  }

  const numerator = Number(parts[0]);
  const denominator = parts.length === 2 ? Number(parts[1]) : 1;

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return Number.NaN;
  }

  return numerator / denominator;
}

export function validateFrameRates(fileName, stream) {
  const rates = [
    {
      label: "average frame rate",
      raw: stream?.avg_frame_rate,
      value: rationalValue(stream?.avg_frame_rate),
    },
    {
      label: "nominal frame rate",
      raw: stream?.r_frame_rate,
      value: rationalValue(stream?.r_frame_rate),
    },
  ];
  const errors = [];

  for (const rate of rates) {
    if (!Number.isFinite(rate.value)) {
      errors.push(
        `${fileName}: ${rate.label} is ${String(rate.raw)}, expected 24`,
      );
      continue;
    }

    if (Math.abs(rate.value - 24) > 0.001) {
      errors.push(
        `${fileName}: ${rate.label} is ${String(rate.value)}, expected 24`,
      );
    }
  }

  const [averageRate, nominalRate] = rates;
  if (
    Number.isFinite(averageRate.value) &&
    Number.isFinite(nominalRate.value) &&
    Math.abs(averageRate.value - nominalRate.value) > 0.001
  ) {
    errors.push(
      `${fileName}: average frame rate ${String(averageRate.value)} differs from nominal frame rate ${String(nominalRate.value)}`,
    );
  }

  return errors;
}

function expectMetadata(errors, fileName, actual, expected, label) {
  if (actual !== expected) {
    errors.push(
      `${fileName}: ${label} is ${String(actual)}, expected ${String(expected)}`,
    );
  }
}

function verifyVideo(filePath, expected, errors, execFileImpl) {
  const metadata = probe(filePath, expected.name, errors, execFileImpl);
  if (!metadata) {
    return;
  }

  const streams = metadata.streams ?? [];
  const videoStreams = streams.filter(
    ({ codec_type: codecType }) => codecType === "video",
  );
  const audioStreams = streams.filter(
    ({ codec_type: codecType }) => codecType === "audio",
  );

  if (videoStreams.length !== 1) {
    errors.push(
      `${expected.name}: video stream count is ${videoStreams.length}, expected 1`,
    );
    return;
  }

  const [stream] = videoStreams;
  const duration = Number(stream.duration ?? metadata.format?.duration);

  expectMetadata(errors, expected.name, stream.codec_name, expected.codec, "codec");
  expectMetadata(errors, expected.name, stream.profile, expected.profile, "profile");
  expectMetadata(errors, expected.name, stream.width, expected.width, "width");
  expectMetadata(errors, expected.name, stream.height, expected.height, "height");
  expectMetadata(errors, expected.name, stream.pix_fmt, "yuv420p", "pixel format");
  if (expected.level !== undefined) {
    expectMetadata(
      errors,
      expected.name,
      stream.level,
      expected.level,
      "codec level",
    );
  }

  const formatName = metadata.format?.format_name;
  if (
    typeof formatName !== "string" ||
    !formatName.split(",").includes(expected.container)
  ) {
    errors.push(
      `${expected.name}: container is ${String(formatName)}, expected ${expected.container}`,
    );
  }
  errors.push(...validateFrameRates(expected.name, stream));
  if (!Number.isFinite(duration) || Math.abs(duration - 8.04) > 0.05) {
    errors.push(
      `${expected.name}: duration is ${duration}, expected approximately 8.04 seconds`,
    );
  }
  if (audioStreams.length !== 0) {
    errors.push(
      `${expected.name}: audio stream count is ${audioStreams.length}, expected 0`,
    );
  }
}

function verifyPoster(filePath, errors, execFileImpl) {
  const metadata = probe(filePath, posterName, errors, execFileImpl);
  const stream = (metadata?.streams ?? []).find(
    ({ codec_type: codecType }) => codecType === "video",
  );

  if (!metadata || !stream) {
    if (metadata) {
      errors.push(`${posterName}: image stream is missing`);
    }
    return;
  }

  expectMetadata(errors, posterName, stream.codec_name, "webp", "codec");
  expectMetadata(errors, posterName, stream.width, 1280, "width");
  expectMetadata(errors, posterName, stream.height, 720, "height");
  expectMetadata(errors, posterName, stream.pix_fmt, "yuv420p", "pixel format");
}

function enforceBudget(errors, label, actual, limit) {
  if (actual > limit) {
    errors.push(`${label}: actual ${actual} bytes; limit ${limit} bytes`);
  }
}

export async function checkMediaBudget({
  projectRoot = defaultProjectRoot,
  logger = console,
  execFileImpl = execFileSync,
} = {}) {
  const videoDirectory = join(projectRoot, "public/videos");
  const posterDirectory = join(projectRoot, "public/images/posters");
  const videoInventory = await inspectMediaDirectory(videoDirectory, {
    expectedNames: expectedVideoNames,
    mediaType: "video",
  });
  const posterInventory = await inspectMediaDirectory(posterDirectory, {
    expectedNames: [posterName],
    mediaType: "poster",
  });
  const errors = [...videoInventory.errors, ...posterInventory.errors];
  const videoFiles = new Map(
    videoInventory.rootFiles.map((entry) => [entry.relativePath, entry]),
  );
  const posterFile = posterInventory.rootFiles.find(
    ({ relativePath }) => relativePath === posterName,
  );
  const videoSizes = new Map();

  for (const expected of expectedVideos) {
    const entry = videoFiles.get(expected.name);
    if (!entry) {
      continue;
    }

    videoSizes.set(expected.name, entry.size);
    verifyVideo(entry.absolutePath, expected, errors, execFileImpl);
  }

  const posterSize = posterFile?.size ?? 0;
  if (posterFile) {
    verifyPoster(posterFile.absolutePath, errors, execFileImpl);
    enforceBudget(errors, "Poster budget", posterSize, posterLimit);
  }

  const totalBytes = videoInventory.totalBytes + posterInventory.totalBytes;
  const desktopBytes =
    posterSize +
    Math.max(
      videoSizes.get("hero-1280.webm") ?? 0,
      videoSizes.get("hero-1280.mp4") ?? 0,
    );
  const mobileBytes =
    posterSize +
    Math.max(
      videoSizes.get("hero-960.webm") ?? 0,
      videoSizes.get("hero-960.mp4") ?? 0,
    );

  enforceBudget(errors, "Retained media total", totalBytes, totalLimit);
  enforceBudget(errors, "Desktop media path", desktopBytes, desktopLimit);
  enforceBudget(errors, "Mobile media path", mobileBytes, mobileLimit);

  if (errors.length > 0) {
    logger.error(`Media budget check failed:\n- ${errors.join("\n- ")}`);
  } else {
    logger.log(
      `Media budget check passed: total ${totalBytes} bytes; desktop ${desktopBytes} bytes; mobile ${mobileBytes} bytes; poster ${posterSize} bytes.`,
    );
  }

  return { desktopBytes, errors, mobileBytes, posterSize, totalBytes };
}

export async function runMediaBudgetCli(options) {
  const result = await checkMediaBudget(options);
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }

  return result;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (moduleFilePath && invokedPath === moduleFilePath) {
  await runMediaBudgetCli();
}
