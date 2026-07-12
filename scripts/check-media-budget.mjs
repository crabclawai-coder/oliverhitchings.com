import { execFileSync } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mediaBudgets,
  mediaRoutes,
  motionFilms,
} from "../src/data/media-manifest.js";

const moduleFilePath = import.meta.url.startsWith("file:")
  ? fileURLToPath(import.meta.url)
  : null;
const defaultProjectRoot = moduleFilePath
  ? resolve(dirname(moduleFilePath), "..")
  : process.cwd();
const expectedVideos = Object.values(motionFilms).flatMap((film) =>
  [...film.variants.mobile, ...film.variants.desktop].map((source) => ({
    ...source,
    durationSeconds: film.durationSeconds,
    filmId: film.id,
    gop: film.gop,
    name: basename(source.src),
  })),
);
const expectedPosters = Object.values(motionFilms).map((film) => ({
  ...film.poster,
  filmId: film.id,
  name: basename(film.poster.src),
}));
const expectedVideoNames = expectedVideos.map(({ name }) => name);
const expectedPosterNames = expectedPosters.map(({ name }) => name);

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

function probe(filePath, fileName, errors, execFileImpl = execFileSync) {
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

function verifyKeyframeGaps(filePath, expected, errors, execFileImpl) {
  let metadata;
  try {
    metadata = JSON.parse(
      execFileImpl(
        "ffprobe",
        [
          "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
          "-show_entries", "frame=best_effort_timestamp_time", "-of", "json",
          filePath,
        ],
        { encoding: "utf8" },
      ),
    );
  } catch (error) {
    errors.push(
      `ffprobe keyframe scan failed for ${expected.name}: ${error.message}`,
    );
    return;
  }

  const timestamps = (metadata.frames ?? [])
    .map(({ best_effort_timestamp_time: timestamp }) => Number(timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > 1.05) {
      errors.push(
        `${expected.name}: adjacent keyframe gap is ${Number(gap.toFixed(6))} seconds, limit 1.05 seconds`,
      );
    }
  }
}

function verifyVideo(filePath, expected, errors, execFileImpl) {
  const metadata = probe(filePath, expected.name, errors, execFileImpl);

  if (expected.filmId === "process") {
    verifyKeyframeGaps(filePath, expected, errors, execFileImpl);
  }
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
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - expected.durationSeconds) > 0.05
  ) {
    errors.push(
      `${expected.name}: duration is ${duration}, expected approximately ${expected.durationSeconds} seconds`,
    );
  }
  if (audioStreams.length !== 0) {
    errors.push(
      `${expected.name}: audio stream count is ${audioStreams.length}, expected 0`,
    );
  }
}

function verifyPoster(filePath, expected, errors, execFileImpl) {
  const metadata = probe(filePath, expected.name, errors, execFileImpl);
  const stream = (metadata?.streams ?? []).find(
    ({ codec_type: codecType }) => codecType === "video",
  );

  if (!metadata || !stream) {
    if (metadata) {
      errors.push(`${expected.name}: image stream is missing`);
    }
    return;
  }

  expectMetadata(errors, expected.name, stream.codec_name, "webp", "codec");
  expectMetadata(errors, expected.name, stream.width, expected.width, "width");
  expectMetadata(errors, expected.name, stream.height, expected.height, "height");
  expectMetadata(errors, expected.name, stream.pix_fmt, "yuv420p", "pixel format");
}

function enforceBudget(errors, label, actual, limit) {
  if (actual > limit) {
    errors.push(`${label}: actual ${actual} bytes; limit ${limit} bytes`);
  }
}

export function calculateTransferBudgets({
  manifest = motionFilms,
  routes = mediaRoutes,
  videoSizes,
  posterSizes,
}) {
  const selectedBytes = (filmId, rendition) => {
    const film = manifest[filmId];
    const videoBytes = Math.max(
      ...film.variants[rendition].map(
        ({ src }) => videoSizes.get(basename(src)) ?? 0,
      ),
    );
    return videoBytes + (posterSizes.get(basename(film.poster.src)) ?? 0);
  };

  return {
    initialDesktop: selectedBytes("hero", "desktop"),
    initialMobile: selectedBytes("hero", "mobile"),
    ...Object.fromEntries(
      Object.entries(routes).map(([route, ids]) => [
        route,
        [...new Set(ids)].reduce(
          (total, id) => total + selectedBytes(id, "desktop"),
          0,
        ),
      ]),
    ),
  };
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
    expectedNames: expectedPosterNames,
    mediaType: "poster",
  });
  const errors = [...videoInventory.errors, ...posterInventory.errors];
  const videoFiles = new Map(
    videoInventory.rootFiles.map((entry) => [entry.relativePath, entry]),
  );
  const posterFiles = new Map(
    posterInventory.rootFiles.map((entry) => [entry.relativePath, entry]),
  );
  const videoSizes = new Map();
  const posterSizes = new Map();

  for (const expected of expectedVideos) {
    const entry = videoFiles.get(expected.name);
    if (!entry) {
      continue;
    }

    videoSizes.set(expected.name, entry.size);
    verifyVideo(entry.absolutePath, expected, errors, execFileImpl);
  }

  for (const expected of expectedPosters) {
    const entry = posterFiles.get(expected.name);
    if (!entry) {
      continue;
    }

    posterSizes.set(expected.name, entry.size);
    verifyPoster(entry.absolutePath, expected, errors, execFileImpl);
    enforceBudget(
      errors,
      `${expected.name} poster budget`,
      entry.size,
      expected.maxBytes,
    );
  }

  const inventoryBytes = videoInventory.totalBytes + posterInventory.totalBytes;
  const posterBytes = posterInventory.totalBytes;
  const transfers = calculateTransferBudgets({ videoSizes, posterSizes });

  enforceBudget(
    errors,
    "Tracked media inventory",
    inventoryBytes,
    mediaBudgets.inventory,
  );
  enforceBudget(
    errors,
    "Initial desktop media path",
    transfers.initialDesktop,
    mediaBudgets.initialDesktop,
  );
  enforceBudget(
    errors,
    "Initial mobile media path",
    transfers.initialMobile,
    mediaBudgets.initialMobile,
  );
  for (const [route, limit] of Object.entries(mediaBudgets.routes)) {
    enforceBudget(errors, `${route} media path`, transfers[route], limit);
  }

  if (errors.length > 0) {
    logger.error(`Media budget check failed:\n- ${errors.join("\n- ")}`);
  } else {
    const routeSummary = Object.keys(mediaBudgets.routes)
      .map((route) => `${route} ${transfers[route]} bytes`)
      .join("; ");
    logger.log(
      `Media budget check passed: inventory ${inventoryBytes} bytes; posters ${posterBytes} bytes; initial desktop ${transfers.initialDesktop} bytes; initial mobile ${transfers.initialMobile} bytes; ${routeSummary}.`,
    );
  }

  return { errors, inventoryBytes, posterBytes, transfers };
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
