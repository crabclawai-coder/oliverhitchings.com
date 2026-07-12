import { describe, expect, it } from "vitest";
import {
  SOURCE_COMMIT,
  buildPosterArguments,
  buildVideoArguments,
} from "../scripts/generate-motion-media.mjs";
import { motionFilms } from "./data/media-manifest.js";

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
});
