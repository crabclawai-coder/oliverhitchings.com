import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SOURCE_COMMIT,
  buildPosterArguments,
  buildVideoArguments,
  generateMotionMedia,
  runMediaGeneratorCli,
} from "../scripts/generate-motion-media.mjs";
import {
  motionFilms,
  restoredFilmIds,
} from "./data/media-manifest.js";

describe("motion media generator", () => {
  it("pins the historical source", () => {
    expect(SOURCE_COMMIT).toBe("26200b9");
  });

  it("uses one-second keyframes for the process MP4", () => {
    const args = buildVideoArguments({
      film: motionFilms.process,
      sourcePath: "/tmp/process.mp4",
      variant: motionFilms.process.variants.desktop[1],
      outputPath: "/tmp/process-1280.mp4",
    });
    expect(args).toEqual(expect.arrayContaining([
      "-c:v", "libx264", "-g", "24", "-keyint_min", "24",
      "-sc_threshold", "0", "-movflags", "+faststart",
    ]));
  });

  it("uses AV1 for WebM and a bounded poster target", () => {
    const videoArgs = buildVideoArguments({
      film: motionFilms.bento,
      sourcePath: "/tmp/bento.mp4",
      variant: motionFilms.bento.variants.mobile[0],
      outputPath: "/tmp/bento-480.webm",
    });
    const posterArgs = buildPosterArguments({
      inputPath: "/tmp/bento.png",
      outputPath: "/tmp/bento.webp",
    });
    expect(videoArgs).toEqual(expect.arrayContaining(["-c:v", "libsvtav1"]));
    expect(posterArgs).toEqual(expect.arrayContaining([
      "-size", String(140 * 1024),
    ]));
  });

  it("recovers the pinned sources and enumerates every output through the CLI", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "motion-generator-test-"));
    const logger = { log: vi.fn() };
    const runner = vi.fn((command) =>
      command === "git" ? Buffer.from("source") : undefined,
    );

    try {
      await expect(runMediaGeneratorCli({
        logger,
        projectRoot,
        runner,
      })).resolves.toEqual({ posterCount: 4, videoCount: 16 });

      expect(
        runner.mock.calls
          .filter(([command]) => command === "git")
          .map(([, args]) => args),
      ).toEqual(
        restoredFilmIds.map((filmId) => [
          "show",
          `${SOURCE_COMMIT}:public/videos/${motionFilms[filmId].legacySource}`,
        ]),
      );

      const videoDirectory = join(projectRoot, "public/videos");
      const posterDirectory = join(projectRoot, "public/images/posters");
      const publicOutputs = runner.mock.calls.flatMap(([command, args]) => {
        const outputPath = args.at(-1);
        if (
          command === "ffmpeg" &&
          dirname(outputPath) === videoDirectory
        ) {
          return [outputPath];
        }
        if (command === "cwebp") {
          return [outputPath];
        }
        return [];
      });
      const expectedOutputs = restoredFilmIds.flatMap((filmId) => {
        const film = motionFilms[filmId];
        return [
          ...film.variants.mobile,
          ...film.variants.desktop,
        ].map(({ src }) => join(videoDirectory, basename(src))).concat(
          join(posterDirectory, `${film.id}.webp`),
        );
      });

      expect(publicOutputs.sort()).toEqual(expectedOutputs.sort());
      expect(logger.log).toHaveBeenCalledWith(
        "Generated 16 video variants and 4 posters.",
      );

      const recoveredSourcePaths = [...new Set(
        runner.mock.calls
          .filter(([command]) => command === "ffmpeg")
          .map(([, args]) => args[args.indexOf("-i") + 1])
          .filter((path) =>
            restoredFilmIds.some(
              (filmId) => basename(path) === motionFilms[filmId].legacySource,
            ),
          ),
      )];
      expect(recoveredSourcePaths).toHaveLength(4);
      for (const sourcePath of recoveredSourcePaths) {
        await expect(access(sourcePath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      await expect(access(dirname(recoveredSourcePaths[0]))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("cleans recovered sources when an encoder fails", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "motion-generator-fail-"));
    const logger = { log: vi.fn() };
    let recoveredSourcePath;
    const runner = vi.fn((command, args) => {
      if (command === "git") {
        return Buffer.from("source");
      }
      if (command === "ffmpeg") {
        recoveredSourcePath = args[args.indexOf("-i") + 1];
        throw new Error("controlled encoder failure");
      }
      return undefined;
    });

    try {
      await expect(generateMotionMedia({
        logger,
        projectRoot,
        runner,
      })).rejects.toThrow("controlled encoder failure");
      expect(recoveredSourcePath).toBeTypeOf("string");
      await expect(access(recoveredSourcePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(dirname(recoveredSourcePath))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
