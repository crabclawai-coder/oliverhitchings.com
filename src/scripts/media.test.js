// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectMediaDirectory,
  validateFrameRates,
} from "../../scripts/check-media-budget.mjs";
import { initializeMedia } from "./media.js";

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
});
