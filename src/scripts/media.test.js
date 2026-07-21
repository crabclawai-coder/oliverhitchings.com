// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as mediaBudgetModule from "../../scripts/check-media-budget.mjs";
import { motionFilms } from "../data/media-manifest.js";
import { initializeMedia } from "./media.js";
import { initializeScrollFilms } from "./scroll-film.js";

const {
  calculateTransferBudgets,
  checkMediaBudget,
  inspectMediaDirectory,
  validateFrameRates,
} = mediaBudgetModule;

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
      this.disconnect = vi.fn();
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
  durationSeconds = 8.04,
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
        duration: String(durationSeconds),
        ...(level === undefined ? {} : { level }),
      },
    ],
    format: {
      duration: String(durationSeconds),
      format_name: container,
    },
  };
}

async function createMediaFixture({
  posterSize = 200 * 1024,
  sizeOverrides = new Map(),
  videoSize = 3 * 1024 * 1024,
} = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "media-budget-check-"));
  const videoDirectory = join(projectRoot, "public/videos");
  const posterDirectory = join(projectRoot, "public/images/posters");
  const films = Object.values(motionFilms);
  const videoNames = films.flatMap((film) =>
    [...film.variants.mobile, ...film.variants.desktop].map(({ src }) =>
      basename(src),
    ),
  );
  const posterNames = films.map((film) => basename(film.poster.src));

  await mkdir(videoDirectory, { recursive: true });
  await mkdir(posterDirectory, { recursive: true });
  await Promise.all(
    videoNames.map((name) =>
      writeFile(
        join(videoDirectory, name),
        Buffer.alloc(sizeOverrides.get(name) ?? videoSize),
      ),
    ),
  );
  await Promise.all(
    posterNames.map((name) =>
      writeFile(join(posterDirectory, name), Buffer.alloc(posterSize)),
    ),
  );

  return {
    posterCount: posterNames.length,
    posterSize,
    projectRoot,
    videoCount: videoNames.length,
    videoSize,
  };
}

function createControlledProbeExecutor({
  controlledFailures = true,
  keyframeResults = new Map(),
} = {}) {
  const metadata = new Map();

  for (const film of Object.values(motionFilms)) {
    for (const variant of [
      ...film.variants.mobile,
      ...film.variants.desktop,
    ]) {
      metadata.set(
        basename(variant.src),
        validVideoMetadata({
          ...variant,
          container: variant.container === "mp4"
            ? "mov,mp4,m4a,3gp,3g2,mj2"
            : "matroska,webm",
          durationSeconds: film.durationSeconds,
        }),
      );
    }

    metadata.set(basename(film.poster.src), {
      streams: [
        {
          codec_type: "video",
          codec_name: "webp",
          width: film.poster.width,
          height: film.poster.height,
          pix_fmt: "yuv420p",
        },
      ],
      format: { format_name: "webp_pipe" },
    });
  }

  if (controlledFailures) {
    metadata.set("process-1280.webm", {
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
    });
    metadata.set("process.webp", {
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
    });
  }

  return vi.fn((_command, args) => {
    const fileName = basename(args.at(-1));
    if (args.includes("-skip_frame")) {
      return JSON.stringify({
        frames: keyframeResults.has(fileName)
          ? keyframeResults.get(fileName)
          : controlledFailures && fileName === "process-1280.webm"
          ? [0, 1, 2.2].map((time) => ({
              best_effort_timestamp_time: String(time),
            }))
          : Array.from({ length: 9 }, (_, time) => ({
              best_effort_timestamp_time: String(time),
            })),
      });
    }
    if (controlledFailures && fileName === "process-960.mp4") {
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

  it("loads scrub-controlled scroll media without autoplaying it", () => {
    const video = renderVideo();
    const observerHarness = createObserverHarness();
    video.dataset.mediaBehaviour = "scroll";
    video.dataset.scrollMode = "scrub";

    initialize({ IntersectionObserver: observerHarness.IntersectionObserver });
    observerHarness
      .getVisibilityObserver()
      .emit([{ target: video, isIntersecting: true }]);

    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("does not resume scrub-controlled scroll media after tab visibility changes", () => {
    const video = renderVideo();
    video.dataset.mediaBehaviour = "scroll";
    video.dataset.scrollMode = "scrub";
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });

    initialize({ IntersectionObserver: undefined });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("autoplays scroll media configured with the loop fallback", () => {
    const video = renderVideo();
    video.dataset.mediaBehaviour = "scroll";
    video.dataset.scrollMode = "loop";

    initialize({ IntersectionObserver: undefined });

    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("loads the nearby process film after the scroll controller selects the no-observer loop fallback", () => {
    document.body.innerHTML = `
      <section data-scroll-film-region>
        <video
          data-media
          data-media-load="nearby"
          data-media-behaviour="scroll"
          data-scroll-film
        >
          <source data-src="/videos/process-1280.webm" type="video/webm" />
          <source data-src="/videos/process-1280.mp4" type="video/mp4" />
        </video>
      </section>
    `;
    const video = document.querySelector("video[data-scroll-film]");
    video.load = vi.fn();
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();

    initializeScrollFilms({
      document,
      window: { innerHeight: 900, innerWidth: 861 },
      matchMedia: motionPreference(false),
      connection: { saveData: false },
      IntersectionObserver: undefined,
    });
    initialize({ IntersectionObserver: undefined });

    expect(video.dataset.scrollMode).toBe("loop");
    expect(
      Array.from(video.querySelectorAll("source"), (source) =>
        source.getAttribute("src"),
      ),
    ).toEqual([
      "/videos/process-1280.webm",
      "/videos/process-1280.mp4",
    ]);
    expect(video.load).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
  });

  it("contains exceptions thrown while loading and pausing media", () => {
    const video = renderVideo();
    const observerHarness = createObserverHarness();
    video.load = vi.fn(() => {
      throw new Error("load unavailable");
    });
    video.pause = vi.fn(() => {
      throw new Error("pause unavailable");
    });

    expect(() =>
      initialize({ IntersectionObserver: observerHarness.IntersectionObserver })
    ).not.toThrow();
    expect(() =>
      observerHarness
        .getVisibilityObserver()
        .emit([{ target: video, isIntersecting: false }])
    ).not.toThrow();
  });

  it("handles rejected load and pause attempts", () => {
    const video = renderVideo();
    const catchLoadRejection = vi.fn();
    const catchPauseRejection = vi.fn();
    video.load = vi.fn().mockReturnValue({ catch: catchLoadRejection });
    video.pause = vi.fn().mockReturnValue({ catch: catchPauseRejection });

    const controller = initialize({ IntersectionObserver: undefined });
    controller.destroy();

    expect(catchLoadRejection).toHaveBeenCalledOnce();
    expect(catchLoadRejection).toHaveBeenCalledWith(expect.any(Function));
    expect(catchPauseRejection).toHaveBeenCalledOnce();
    expect(catchPauseRejection).toHaveBeenCalledWith(expect.any(Function));
  });

  it("disconnects observers, removes its listener and safely pauses on destroy", () => {
    const video = renderVideo("nearby");
    const observerHarness = createObserverHarness();
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    video.pause = vi.fn(() => {
      throw new Error("pause unavailable");
    });

    const controller = initialize({
      IntersectionObserver: observerHarness.IntersectionObserver,
    });
    const visibilityListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "visibilitychange",
    )[1];

    expect(() => controller.destroy()).not.toThrow();
    expect(controller.loadObserver.disconnect).toHaveBeenCalledOnce();
    expect(controller.visibilityObserver.disconnect).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      visibilityListener,
    );
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("ignores observer callbacks delivered after destroy", () => {
    const video = renderVideo("nearby");
    const observerHarness = createObserverHarness();
    const controller = initialize({
      IntersectionObserver: observerHarness.IntersectionObserver,
    });

    controller.destroy();
    observerHarness
      .getLoadObserver()
      .emit([{ target: video, isIntersecting: true }]);
    observerHarness
      .getVisibilityObserver()
      .emit([{ target: video, isIntersecting: true }]);

    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalledOnce();
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

  it("loads eager and nearby loop media when IntersectionObserver is unavailable", () => {
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
    expect(nearbyVideo.querySelector("source").getAttribute("src")).toBe(
      "/videos/nearby.mp4",
    );
    expect(nearbyVideo.load).toHaveBeenCalledOnce();
    expect(nearbyVideo.play).toHaveBeenCalledOnce();
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
  it("deduplicates route films and budgets the larger selected format", () => {
    const videoSizes = new Map([
      ["hero-1280.webm", 100],
      ["hero-1280.mp4", 110],
      ["hero-960.webm", 80],
      ["hero-960.mp4", 75],
      ["process-1280.webm", 200],
      ["process-1280.mp4", 190],
    ]);
    const posterSizes = new Map([
      ["hero.webp", 10],
      ["process.webp", 20],
    ]);

    expect(calculateTransferBudgets({
      routes: { home: ["hero", "process", "hero"] },
      posterSizes,
      videoSizes,
    })).toEqual({
      home: 340,
      initialDesktop: 120,
      initialMobile: 90,
    });
  });

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

  it.each([
    ["empty", [], "process-1280.webm: keyframe scan returned no usable timestamps"],
    [
      "non-finite-only",
      [{ best_effort_timestamp_time: "not-a-number" }],
      "process-1280.webm: keyframe scan returned no usable timestamps",
    ],
    [
      "single-entry",
      [{ best_effort_timestamp_time: "0" }],
      "process-1280.webm: keyframe scan returned 1 usable timestamp, expected at least 2",
    ],
    [
      "sparse",
      [0, 1].map((time) => ({
        best_effort_timestamp_time: String(time),
      })),
      "process-1280.webm: keyframe timeline ends at 1 seconds, expected within 1.05 seconds of 8.04",
    ],
  ])("rejects %s process keyframe results", async (_label, frames, error) => {
    const fixture = await createMediaFixture({ posterSize: 1, videoSize: 1 });
    const execFileImpl = createControlledProbeExecutor({
      controlledFailures: false,
      keyframeResults: new Map([["process-1280.webm", frames]]),
    });

    try {
      const result = await checkMediaBudget({
        execFileImpl,
        logger: { error: vi.fn(), log: vi.fn() },
        projectRoot: fixture.projectRoot,
      });

      expect(result.errors).toEqual([error]);
    } finally {
      await rm(fixture.projectRoot, { force: true, recursive: true });
    }
  });

  it("reports an isolated Blog route overage", async () => {
    const fixture = await createMediaFixture({
      posterSize: 1,
      sizeOverrides: new Map([
        ["cta-footer-1280.webm", 3 * 1024 * 1024],
      ]),
      videoSize: 1,
    });

    try {
      const result = await checkMediaBudget({
        execFileImpl: createControlledProbeExecutor({
          controlledFailures: false,
        }),
        logger: { error: vi.fn(), log: vi.fn() },
        projectRoot: fixture.projectRoot,
      });

      expect(result.errors).toEqual([
        `blog media path: actual ${3 * 1024 * 1024 + 1} bytes; limit ${3 * 1024 * 1024} bytes`,
      ]);
    } finally {
      await rm(fixture.projectRoot, { force: true, recursive: true });
    }
  });

  it("reports controlled metadata, probe, and byte-budget failures", async () => {
    const fixture = await createMediaFixture();
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
          "process-1280.webm: codec is h264, expected av1",
          "process-1280.webm: profile is Baseline, expected Main",
          "process-1280.webm: width is 640, expected 1280",
          "process-1280.webm: height is 360, expected 720",
          "process-1280.webm: pixel format is yuv444p, expected yuv420p",
          "process-1280.webm: container is mov,mp4, expected webm",
          "process-1280.webm: duration is 3, expected approximately 8.04 seconds",
          "process-1280.webm: audio stream count is 1, expected 0",
          "process-1280.webm: adjacent keyframe gap is 1.2 seconds, limit 1.05 seconds",
          "ffprobe failed for process-960.mp4: fixture probe failed",
          "process.webp: codec is png, expected webp",
          "process.webp: width is 640, expected 1280",
          "process.webp: height is 360, expected 720",
          "process.webp: pixel format is rgba, expected yuv420p",
          `process.webp poster budget: actual ${fixture.posterSize} bytes; limit ${150 * 1024} bytes`,
          `Tracked media inventory: actual ${fixture.videoSize * fixture.videoCount + fixture.posterSize * fixture.posterCount} bytes; limit ${24 * 1024 * 1024} bytes`,
          `Initial desktop media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${2.5 * 1024 * 1024} bytes`,
          `Initial mobile media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${1.75 * 1024 * 1024} bytes`,
          `home media path: actual ${(fixture.videoSize + fixture.posterSize) * 5} bytes; limit ${8 * 1024 * 1024} bytes`,
          `services media path: actual ${(fixture.videoSize + fixture.posterSize) * 2} bytes; limit ${4 * 1024 * 1024} bytes`,
          `about media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${3 * 1024 * 1024} bytes`,
          `blog media path: actual ${fixture.videoSize + fixture.posterSize} bytes; limit ${3 * 1024 * 1024} bytes`,
        ]),
      );
      expect(result.inventoryBytes).toBe(
        fixture.videoSize * fixture.videoCount +
          fixture.posterSize * fixture.posterCount,
      );
      expect(result.posterBytes).toBe(
        fixture.posterSize * fixture.posterCount,
      );
      expect(execFileImpl).toHaveBeenCalledTimes(
        fixture.videoCount + fixture.posterCount +
          motionFilms.process.variants.mobile.length +
          motionFilms.process.variants.desktop.length,
      );
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
