// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeScrollFilms } from "./scroll-film.js";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function motionPreference(matches = false) {
  return vi.fn().mockImplementation((query) => ({
    matches: query === REDUCED_MOTION_QUERY && matches,
  }));
}

function createObserverHarness() {
  let instance;

  class TestIntersectionObserver {
    constructor(callback, options = {}) {
      this.callback = callback;
      this.options = options;
      this.disconnect = vi.fn();
      this.observe = vi.fn();
      instance = this;
    }

    emit(entries) {
      this.callback(entries, this);
    }
  }

  return {
    IntersectionObserver: TestIntersectionObserver,
    getInstance: () => instance,
  };
}

function createRafHarness() {
  const queued = new Map();
  let nextId = 1;

  const requestAnimationFrame = vi.fn((callback) => {
    const id = nextId;
    nextId += 1;
    queued.set(id, callback);
    return id;
  });
  const cancelAnimationFrame = vi.fn((id) => queued.delete(id));

  return {
    cancelAnimationFrame,
    flush() {
      const callbacks = Array.from(queued.values());
      queued.clear();
      callbacks.forEach((callback) => callback(0));
    },
    queued,
    requestAnimationFrame,
  };
}

function renderFixture({
  duration = 8,
  height = 900,
  top = 0,
  width = 861,
} = {}) {
  document.body.innerHTML = `
    <section data-scroll-film-region>
      <video data-scroll-film></video>
    </section>
  `;

  const region = document.querySelector("[data-scroll-film-region]");
  const video = document.querySelector("video[data-scroll-film]");
  const rect = { height, top };
  const listeners = new Map();
  let currentTime = 0;
  let currentDuration = duration;
  const seek = vi.fn((value) => {
    if (!Number.isFinite(value)) {
      throw new TypeError("currentTime must be finite");
    }
    currentTime = value;
  });

  region.getBoundingClientRect = vi.fn(() => ({ ...rect }));
  video.pause = vi.fn();
  video.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => currentDuration,
  });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: seek,
  });

  const windowRef = {
    addEventListener: vi.fn((eventName, listener) => {
      if (!listeners.has(eventName)) {
        listeners.set(eventName, new Set());
      }
      listeners.get(eventName).add(listener);
    }),
    innerHeight: 900,
    innerWidth: width,
    removeEventListener: vi.fn((eventName, listener) => {
      listeners.get(eventName)?.delete(listener);
    }),
  };

  return {
    emitWindow(eventName) {
      Array.from(listeners.get(eventName) ?? []).forEach((listener) =>
        listener(new Event(eventName)),
      );
    },
    listeners,
    rect,
    region,
    seek,
    setDuration(value) {
      currentDuration = value;
    },
    video,
    windowRef,
  };
}

function initializeFixture(
  fixture,
  observerHarness,
  rafHarness,
  overrides = {},
) {
  return initializeScrollFilms({
    document,
    window: fixture.windowRef,
    matchMedia: motionPreference(false),
    connection: { saveData: false },
    IntersectionObserver: observerHarness.IntersectionObserver,
    requestAnimationFrame: rafHarness.requestAnimationFrame,
    cancelAnimationFrame: rafHarness.cancelAnimationFrame,
    ...overrides,
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

describe("initializeScrollFilms", () => {
  it("sets scrub mode at the 861px boundary and observes the containing region", () => {
    const fixture = renderFixture({ width: 861 });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);

    expect(fixture.video.dataset.scrollMode).toBe("scrub");
    expect(observerHarness.getInstance().observe).toHaveBeenCalledWith(
      fixture.region,
    );
  });

  it("uses loop mode at 860px without seeking", () => {
    const fixture = renderFixture({ width: 860 });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(rafHarness.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("transitions from scrub to loop at 860px and clears scrub work", () => {
    const fixture = renderFixture({ duration: Number.NaN, width: 861 });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    const addEventListener = vi.spyOn(fixture.video, "addEventListener");
    const removeEventListener = vi.spyOn(fixture.video, "removeEventListener");

    initializeFixture(fixture, observerHarness, rafHarness);
    const observer = observerHarness.getInstance();
    expect(observer).toBeDefined();
    observer.emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();
    const metadataListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "loadedmetadata",
    )[1];
    fixture.emitWindow("scroll");
    const queuedFrame = Array.from(rafHarness.queued.keys())[0];

    fixture.windowRef.innerWidth = 860;
    fixture.emitWindow("resize");

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(fixture.video.play).toHaveBeenCalledOnce();
    expect(rafHarness.cancelAnimationFrame).toHaveBeenCalledWith(queuedFrame);
    expect(removeEventListener).toHaveBeenCalledWith(
      "loadedmetadata",
      metadataListener,
    );
    expect(observer.disconnect).not.toHaveBeenCalled();
  });

  it("transitions from loop to scrub when resized from 860px to 861px", () => {
    const fixture = renderFixture({ width: 860 });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);
    const observer = observerHarness.getInstance();
    expect(observer).toBeDefined();
    observer.emit([{ target: fixture.region, isIntersecting: true }]);

    fixture.windowRef.innerWidth = 861;
    fixture.emitWindow("resize");

    expect(fixture.video.dataset.scrollMode).toBe("scrub");
    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledOnce();

    rafHarness.flush();
    expect(fixture.video.currentTime).toBe(4);
  });

  it("uses loop mode when IntersectionObserver is unavailable", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness, {
      IntersectionObserver: undefined,
    });

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(rafHarness.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it.each([
    {
      condition: "reduced motion",
      overrides: { matchMedia: motionPreference(true) },
    },
    {
      condition: "Save-Data",
      overrides: { connection: { saveData: true } },
    },
  ])("uses a paused poster under $condition", ({ overrides }) => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness, overrides);

    expect(fixture.video.dataset.scrollMode).toBe("poster");
    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(fixture.video.play).not.toHaveBeenCalled();
    expect(observerHarness.getInstance()).toBeUndefined();

    fixture.windowRef.innerWidth = 860;
    fixture.emitWindow("resize");
    fixture.windowRef.innerWidth = 861;
    fixture.emitWindow("resize");
    expect(fixture.video.dataset.scrollMode).toBe("poster");
  });

  it("attaches passive scroll and resize listeners only while intersecting", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);
    const observer = observerHarness.getInstance();

    expect(fixture.windowRef.addEventListener).not.toHaveBeenCalled();
    observer.emit([{ target: fixture.region, isIntersecting: false }]);
    expect(fixture.windowRef.addEventListener).not.toHaveBeenCalled();

    observer.emit([{ target: fixture.region, isIntersecting: true }]);
    expect(fixture.windowRef.addEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      { passive: true },
    );
    expect(fixture.windowRef.addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
      { passive: true },
    );

    observer.emit([{ target: fixture.region, isIntersecting: false }]);
    expect(fixture.listeners.get("scroll")).toHaveLength(0);
    expect(fixture.listeners.get("resize")).toHaveLength(0);
  });

  it("queues at most one animation frame for each scroll or resize burst", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);
    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    fixture.emitWindow("scroll");
    fixture.emitWindow("resize");
    fixture.emitWindow("scroll");

    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledOnce();

    rafHarness.flush();
    fixture.emitWindow("resize");
    fixture.emitWindow("scroll");

    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it.each([
    { expectedTime: 0, label: "0 progress", top: 1200 },
    { expectedTime: 4, label: "0.5 progress", top: 0 },
    { expectedTime: 8, label: "1 progress", top: -1200 },
  ])("clamps and seeks to $label", ({ expectedTime, top }) => {
    const fixture = renderFixture({ height: 900, top });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);
    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();

    expect(fixture.video.currentTime).toBe(expectedTime);
  });

  it("waits for loaded metadata before its first seek", () => {
    const fixture = renderFixture({ duration: Number.NaN });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();

    initializeFixture(fixture, observerHarness, rafHarness);
    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();

    expect(fixture.seek).not.toHaveBeenCalled();
    expect(fixture.video.dataset.scrollMode).toBe("scrub");
    expect(fixture.video.play).not.toHaveBeenCalled();

    fixture.setDuration(8);
    fixture.video.dispatchEvent(new Event("loadedmetadata"));
    rafHarness.flush();

    expect(fixture.seek).toHaveBeenCalledOnce();
    expect(fixture.video.currentTime).toBe(4);
    expect(fixture.video.dataset.scrollMode).toBe("scrub");
  });

  it("falls back to loop playback when seeking fails", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    Object.defineProperty(fixture.video, "currentTime", {
      configurable: true,
      set: () => {
        throw new Error("seek unavailable");
      },
    });

    initializeFixture(fixture, observerHarness, rafHarness);
    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(fixture.video.play).toHaveBeenCalledOnce();
  });

  it("does not re-arm scrub after terminal seek fallback", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    Object.defineProperty(fixture.video, "currentTime", {
      configurable: true,
      set: () => {
        throw new Error("seek unavailable");
      },
    });

    initializeFixture(fixture, observerHarness, rafHarness);
    const observer = observerHarness.getInstance();
    observer.emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(fixture.listeners.get("scroll")).toHaveLength(0);
    expect(fixture.listeners.get("resize")).toHaveLength(0);

    observer.emit([{ target: fixture.region, isIntersecting: true }]);

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(fixture.listeners.get("scroll")).toHaveLength(0);
    expect(fixture.listeners.get("resize")).toHaveLength(0);
    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(fixture.video.play).toHaveBeenCalledOnce();
  });

  it("does not start loop fallback while the document is hidden", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(fixture.video, "currentTime", {
      configurable: true,
      set: () => {
        throw new Error("seek unavailable");
      },
    });

    initializeFixture(fixture, observerHarness, rafHarness);
    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();

    expect(fixture.video.dataset.scrollMode).toBe("loop");
    expect(fixture.video.play).not.toHaveBeenCalled();
  });

  it("disconnects, removes active listeners and cancels queued work on destroy", () => {
    const fixture = renderFixture();
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    const controller = initializeFixture(
      fixture,
      observerHarness,
      rafHarness,
    );
    const observer = observerHarness.getInstance();

    observer.emit([{ target: fixture.region, isIntersecting: true }]);
    const queuedFrame = Array.from(rafHarness.queued.keys())[0];
    controller.destroy();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(fixture.listeners.get("scroll")).toHaveLength(0);
    expect(fixture.listeners.get("resize")).toHaveLength(0);
    expect(rafHarness.cancelAnimationFrame).toHaveBeenCalledWith(queuedFrame);

    observer.emit([{ target: fixture.region, isIntersecting: true }]);
    fixture.emitWindow("scroll");
    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("removes a pending metadata listener on destroy", () => {
    const fixture = renderFixture({ duration: Number.NaN });
    const observerHarness = createObserverHarness();
    const rafHarness = createRafHarness();
    const addEventListener = vi.spyOn(fixture.video, "addEventListener");
    const removeEventListener = vi.spyOn(fixture.video, "removeEventListener");
    const controller = initializeFixture(
      fixture,
      observerHarness,
      rafHarness,
    );

    observerHarness
      .getInstance()
      .emit([{ target: fixture.region, isIntersecting: true }]);
    rafHarness.flush();
    const metadataListener = addEventListener.mock.calls.find(
      ([eventName]) => eventName === "loadedmetadata",
    )[1];

    controller.destroy();

    expect(removeEventListener).toHaveBeenCalledWith(
      "loadedmetadata",
      metadataListener,
    );
    fixture.setDuration(8);
    fixture.video.dispatchEvent(new Event("loadedmetadata"));
    expect(rafHarness.requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("returns a safe controller when the page has no scroll film", () => {
    document.body.innerHTML = "<main>Static page</main>";

    const controller = initializeScrollFilms({ document });

    expect(() => controller.destroy()).not.toThrow();
  });
});
