// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as mediaBudgetModule from "../../scripts/check-media-budget.mjs";
import { initializeMedia } from "./media.js";

const { checkMediaBudget, inspectMediaDirectory, validateFrameRates } =
  mediaBudgetModule;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function motionPreference(matches = false) {
  return vi.fn().mockImplementation((query) => ({
    matches: query === REDUCED_MOTION_QUERY && matches,
  }));
}

function createObserverHarness() {
  const instances = [];

  class TestIntersectionObserver {
    constructor(callback, options = {}) {
      this.callback = callback;
      this.options = options;
      this.observe = vi.fn();
      this.unobserve = vi.fn();
      instances.push(this);
    }

    emit(entries) {
      this.callback(entries, this);
    }
  }

  return {
    IntersectionObserver: TestIntersectionObserver,
    instances,
    getLoadObserver: () =>
      instances.find((instance) => instance.options.rootMargin === "320px 0px"),
    getVisibilityObserver: () =>
      instances.find((instance) => instance.options.rootMargin !== "320px 0px"),
  };
}

function renderVideo(loadMode = "eager") {
  document.body.innerHTML = `
    <video data-media data-media-load="${loadMode}" poster="/poster.webp">
      <source data-src="/videos/hero.webm" type="video/webm" />
      <source data-src="/videos/hero.mp4" type="video/mp4" />
    </video>
  `;

  const video = document.querySelector("video");
  video.load = vi.fn();
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();

  return video;
}

function validVideoMetadata({
  codec,
  container,
  height,
  level,
  profile,
  width,
}) {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: codec,
        profile,
        width,
        height,
        pix_fmt: "yuv420p",
        avg_frame_rate: "24/1",
        r_frame_rate: "24/1",
        duration: "8.04",
        ...(level === undefined ? {} : { level }),
      },
    ],
    format: {
      duration: "8.04",
      format_name: container,
    },
  };
}

async function createOversizedMediaFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "media-budget-check-"));
  const videoDirectory = join(projectRoot, "public/videos");
  const posterDirectory = join(projectRoot, "public/images/posters");
  const videoNames = [
    "hero-1280.webm",
    "hero-1280.mp4",
    "hero-960.webm",
    "hero-960.mp4",
  ];
  const videoSize = 3 * 1024 * 1024;
  const posterSize = 200 * 1024;

  await mkdir(videoDirectory, { recursive: true });
  await mkdir(posterDirectory, { recursive: true });
  await Promise.all(
    videoNames.map((name) =>
      writeFile(join(videoDirectory, name), Buffer.alloc(videoSize)),
    ),
  );
  await writeFile(
    join(posterDirectory, "hero.webp"),
    Buffer.alloc(posterSize),
  );

  return { posterSize, projectRoot, videoSize };
}

function createControlledProbeExecutor() {
  const metadata = new Map([
    [
      "hero-1280.webm",
      {
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            profile: "Baseline",
            width: 640,
            height: 360,
            pix_fmt: "yuv444p",
            avg_frame_rate: "30/1",
            r_frame_rate: "30/1",
            duration: "3",
            level: 10,
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
        format: { duration: "3", format_name: "mov,mp4" },
      },
    ],
    [
      "hero-1280.mp4",
      validVideoMetadata({
        codec: "h264",
        container: "mov,mp4,m4a,3gp,3g2,mj2",
        height: 720,
        level: 40,
        profile: "High",
        width: 1280,
      }),
    ],
    [
      "hero-960.webm",
      validVideoMetadata({
        codec: "av1",
        container: "matroska,webm",
        height: 540,
        profile: "Main",
        width: 960,
      }),
    ],
    [
      "hero.webp",
      {
        streams: [
          {
            codec_type: "video",
            codec_name: "png",
            width: 640,
            height: 360,
            pix_fmt: "rgba",
          },
        ],
        format: { format_name: "image2" },
      },
    ],
  ]);

  return vi.fn((_command, args) => {
    const fileName = basename(args.at(-1));
    if (fileName === "hero-960.mp4") {
      throw new Error("fixture probe failed");
    }

    return JSON.stringify(metadata.get(fileName));
  });
}

function initialize({
  connection = { saveData: false },
  IntersectionObserver,
  matchMedia = motionPreference(false),
} = {}) {
  return initializeMedia({
    document,
    matchMedia,
    connection,
    IntersectionObserver,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  vi.restoreAllMocks();
});

describe("initializeMedia", () => {
  it("promotes eager sources once, then loads and plays the video", () => {
    const video = renderVideo();
    const observerHarness = createObserverHarness();

    initialize({ IntersectionObserver: observerHarness.IntersectionObserver });
    initialize({ IntersectionObserver: observerHarness.IntersectionObserver });

    expect(
      Array.from(video.querySelectorAll("source"), (source) =>
        source.getAttribute("src"),
      ),
    ).toEqual(["/videos/hero.webm", "/videos/hero.mp4"]);
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("does not load nearby media until it enters the load observer margin", () => {
    const video = renderVideo("nearby");
    const observerHarness = createObserverHarness();

    initialize({ IntersectionObserver: observerHarness.IntersectionObserver });

    const loadObserver = observerHarness.getLoadObserver();
    expect(loadObserver.options).toMatchObject({ rootMargin: "320px 0px" });
    expect(loadObserver.observe).toHaveBeenCalledWith(video);
    expect(video.querySelector("source").hasAttribute("src")).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();

    loadObserver.emit([{ target: video, isIntersecting: false }]);
    expect(video.load).not.toHaveBeenCalled();

    loadObserver.emit([{ target: video, isIntersecting: true }]);
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(loadObserver.unobserve).toHaveBeenCalledWith(video);

    observerHarness
      .getVisibilityObserver()
      .emit([{ target: video, isIntersecting: true }]);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("pauses loaded offscreen media and resumes it when visible", () => {
    const video = renderVideo();
    const observerHarness = createObserverHarness();

    initialize({ IntersectionObserver: observerHarness.IntersectionObserver });

    const visibilityObserver = observerHarness.getVisibilityObserver();
    expect(visibilityObserver.observe).toHaveBeenCalledWith(video);

    visibilityObserver.emit([{ target: video, isIntersecting: false }]);
    expect(video.pause).toHaveBeenCalledOnce();

    visibilityObserver.emit([{ target: video, isIntersecting: true }]);
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("leaves sources unpromoted and pauses media under reduced motion", () => {
    const video = renderVideo();

    initialize({
      IntersectionObserver: class UnexpectedObserver {
        constructor() {
          throw new Error("Reduced motion must not create observers");
        }
      },
      matchMedia: motionPreference(true),
    });

    expect(video.querySelector("source").hasAttribute("src")).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("leaves sources unpromoted and pauses media when Save-Data is enabled", () => {
    const video = renderVideo();

    initialize({
      connection: { saveData: true },
      IntersectionObserver: class UnexpectedObserver {
        constructor() {
          throw new Error("Save-Data must not create observers");
        }
      },
    });

    expect(video.querySelector("source").hasAttribute("src")).toBe(false);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("handles a rejected play promise", () => {
    const video = renderVideo();
    const catchRejection = vi.fn();
    video.play = vi.fn().mockReturnValue({ catch: catchRejection });

    expect(() => initialize({ IntersectionObserver: undefined })).not.toThrow();
    expect(catchRejection).toHaveBeenCalledOnce();
    expect(catchRejection).toHaveBeenCalledWith(expect.any(Function));
  });

  it("loads eager media only when IntersectionObserver is unavailable", () => {
    document.body.innerHTML = `
      <video data-media data-media-load="eager">
        <source data-src="/videos/eager.mp4" type="video/mp4" />
      </video>
      <video data-media data-media-load="nearby" poster="/nearby.webp">
        <source data-src="/videos/nearby.mp4" type="video/mp4" />
      </video>
    `;
    const [eagerVideo, nearbyVideo] = document.querySelectorAll("video");

    for (const video of [eagerVideo, nearbyVideo]) {
      video.load = vi.fn();
      video.play = vi.fn().mockResolvedValue(undefined);
      video.pause = vi.fn();
    }

    initialize({ IntersectionObserver: undefined });

    expect(eagerVideo.querySelector("source").getAttribute("src")).toBe(
      "/videos/eager.mp4",
    );
    expect(eagerVideo.load).toHaveBeenCalledOnce();
    expect(eagerVideo.play).toHaveBeenCalledOnce();
    expect(nearbyVideo.querySelector("source").hasAttribute("src")).toBe(false);
    expect(nearbyVideo.load).not.toHaveBeenCalled();
    expect(nearbyVideo.play).not.toHaveBeenCalled();
  });

  it("does not play eager media when the document is already hidden", () => {
    const video = renderVideo();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    initialize({ IntersectionObserver: undefined });

    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("pauses hidden media and resumes visible loaded media", () => {
    const video = renderVideo();

    initialize({ IntersectionObserver: undefined });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(video.pause).toHaveBeenCalledOnce();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(video.play).toHaveBeenCalledTimes(2);
  });
});

describe("media budget helpers", () => {
  it("rejects non-finite average and nominal frame rates", async () => {
    const validationErrors = validateFrameRates("bad.webm", {
      avg_frame_rate: "0/0",
      r_frame_rate: "not-a-rate",
    });

    expect(validationErrors).toEqual(
      expect.arrayContaining([
        "bad.webm: average frame rate is 0/0, expected 24",
        "bad.webm: nominal frame rate is not-a-rate, expected 24",
      ]),
    );
  });

  it("rejects differing average and nominal frame rates", async () => {
    const validationErrors = validateFrameRates("mixed.mp4", {
      avg_frame_rate: "24/1",
      r_frame_rate: "30/1",
    });

    expect(validationErrors).toEqual(
      expect.arrayContaining([
        "mixed.mp4: nominal frame rate is 30, expected 24",
        "mixed.mp4: average frame rate 24 differs from nominal frame rate 30",
      ]),
    );
  });

  it("recursively rejects nested and symlinked media inventory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "media-budget-inventory-"));

    try {
      const nestedDirectory = join(directory, "nested");
      const nestedVideo = join(nestedDirectory, "extra.mp4");
      await mkdir(nestedDirectory);
      await writeFile(nestedVideo, "x");
      await symlink(nestedVideo, join(directory, "linked.mp4"));

      const result = await inspectMediaDirectory(directory, {
        expectedNames: ["hero-1280.mp4"],
        mediaType: "video",
      });

      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Unexpected video symlink: linked.mp4",
          "Unexpected video directory: nested/",
          "Unexpected video file: nested/extra.mp4",
        ]),
      );
      expect(result.totalBytes).toBe(1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports controlled metadata, probe, and byte-budget failures", async () => {
    const fixture = await createOversizedMediaFixture();
    const execFileImpl = createControlledProbeExecutor();
    const logger = { error: vi.fn(), log: vi.fn() };

    try {
      const result = await checkMediaBudget({
        projectRoot: fixture.projectRoot,
        logger,
        execFileImpl,
      });

      expect(result.errors).toEqual(
        expect.arrayContaining([
          "hero-1280.webm: codec is h264, expected av1",
          "hero-1280.webm: profile is Baseline, expected Main",
          "hero-1280.webm: width is 640, expected 1280",
          "hero-1280.webm: height is 360, expected 720",
          "hero-1280.webm: pixel format is yuv444p, expected yuv420p",
          "hero-1280.webm: container is mov,mp4, expected webm",
          "hero-1280.webm: duration is 3, expected approximately 8.04 seconds",
          "hero-1280.webm: audio stream count is 1, expected 0",
          "ffprobe failed for hero-960.mp4: fixture probe failed",
          "hero.webp: codec is png, expected webp",
          "hero.webp: width is 640, expected 1280",
          "hero.webp: height is 360, expected 720",
          "hero.webp: pixel format is rgba, expected yuv420p",
          `Poster budget: actual ${fixture.posterSize} bytes; limit ${150 * 1024} bytes`,
          `Retained media total: actual ${fixture.videoSize * 4 + fixture.posterSize} bytes; limit ${8 * 1024 * 1024} bytes`,
          `Desktop media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${2.5 * 1024 * 1024} bytes`,
          `Mobile media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${1.75 * 1024 * 1024} bytes`,
        ]),
      );
      expect(result.totalBytes).toBe(
        fixture.videoSize * 4 + fixture.posterSize,
      );
      expect(execFileImpl).toHaveBeenCalledTimes(5);
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      await rm(fixture.projectRoot, { force: true, recursive: true });
    }
  });

  it("sets a non-zero CLI exit code when the media check fails", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "media-budget-cli-"));
    const logger = { error: vi.fn(), log: vi.fn() };
    const initialExitCode = process.exitCode;

    try {
      process.exitCode = undefined;
      expect(mediaBudgetModule.runMediaBudgetCli).toBeTypeOf("function");

      const result = await mediaBudgetModule.runMediaBudgetCli({
        projectRoot,
        logger,
      });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(process.exitCode).toBe(1);
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      process.exitCode = initialExitCode;
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
