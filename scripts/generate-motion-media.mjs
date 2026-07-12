import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { motionFilms, restoredFilmIds } from "../src/data/media-manifest.js";

export const SOURCE_COMMIT = "26200b9";
const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(modulePath), "..");

function scaleFilter(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24,format=yuv420p`;
}

export function buildVideoArguments({ film, sourcePath, variant, outputPath }) {
  const desktop = variant.media === null;
  const common = [
    "-y", "-i", sourcePath, "-an", "-vf",
    scaleFilter(variant.width, variant.height),
    "-r", "24", "-g", String(film.gop), "-pix_fmt", "yuv420p",
  ];
  if (variant.container === "webm") {
    return [
      ...common, "-c:v", "libsvtav1", "-preset", "6",
      "-crf", desktop ? "42" : "42", outputPath,
    ];
  }
  return [
    ...common, "-c:v", "libx264", "-preset", "slow",
    "-crf", desktop ? "32" : "32", "-profile:v", "high",
    "-level:v", variant.level === 40 ? "4.0" : "3.1",
    "-keyint_min", String(film.gop), "-sc_threshold", "0",
    "-movflags", "+faststart", outputPath,
  ];
}

export function buildPosterArguments({ inputPath, outputPath }) {
  return [
    "-quiet", "-q", "78", "-size", String(140 * 1024),
    inputPath, "-o", outputPath,
  ];
}

export async function generateMotionMedia({
  projectRoot = defaultRoot,
  runner = execFileSync,
  logger = console,
} = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "oh-motion-media-"));
  const videoDirectory = join(projectRoot, "public/videos");
  const posterDirectory = join(projectRoot, "public/images/posters");
  await mkdir(videoDirectory, { recursive: true });
  await mkdir(posterDirectory, { recursive: true });
  let videoCount = 0;
  let posterCount = 0;

  try {
    for (const filmId of restoredFilmIds) {
      const film = motionFilms[filmId];
      const sourcePath = join(temporaryRoot, film.legacySource);
      const source = runner(
        "git",
        ["show", `${SOURCE_COMMIT}:public/videos/${film.legacySource}`],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      await writeFile(sourcePath, source);

      for (const variant of [
        ...film.variants.mobile,
        ...film.variants.desktop,
      ]) {
        const outputPath = join(videoDirectory, basename(variant.src));
        runner(
          "ffmpeg",
          buildVideoArguments({ film, sourcePath, variant, outputPath }),
          { stdio: "inherit" },
        );
        videoCount += 1;
      }

      const posterPng = join(temporaryRoot, `${film.id}.png`);
      runner(
        "ffmpeg",
        [
          "-y", "-ss", "1", "-i", sourcePath, "-frames:v", "1",
          "-vf", scaleFilter(film.width, film.height), posterPng,
        ],
        { stdio: "inherit" },
      );
      runner(
        "cwebp",
        buildPosterArguments({
          inputPath: posterPng,
          outputPath: join(posterDirectory, `${film.id}.webp`),
        }),
        { stdio: "inherit" },
      );
      posterCount += 1;
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }

  logger.log(`Generated ${videoCount} video variants and ${posterCount} posters.`);
  return { posterCount, videoCount };
}

export async function runMediaGeneratorCli(options) {
  return generateMotionMedia(options);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  await runMediaGeneratorCli();
}
