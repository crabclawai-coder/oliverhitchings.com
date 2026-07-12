// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeSiteBehaviour } from "./site-behaviour.js";

function reducedMotion(matches) {
  return vi.fn().mockReturnValue({ matches });
}

function createObserverHarness() {
  let instance;

  class TestIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observe = vi.fn();
      this.unobserve = vi.fn();
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

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("initializeSiteBehaviour", () => {
  it("shows explicit reveal targets immediately under reduced motion", () => {
    document.body.innerHTML = `<section data-reveal>Visible without motion</section>`;
    const target = document.querySelector("[data-reveal]");

    initializeSiteBehaviour({
      document,
      matchMedia: reducedMotion(true),
      IntersectionObserver: class UnexpectedObserver {
        constructor() {
          throw new Error("Reduced motion must not create an observer");
        }
      },
    });

    expect(target.classList.contains("is-visible")).toBe(true);
    expect(target.classList.contains("is-reveal-ready")).toBe(false);
  });

  it("pauses autoplaying video and removes autoplay under reduced motion", () => {
    document.body.innerHTML = `
      <video autoplay muted></video>
      <video muted></video>
    `;
    const [autoplayingVideo, staticVideo] = document.querySelectorAll("video");
    autoplayingVideo.pause = vi.fn();
    staticVideo.pause = vi.fn();

    initializeSiteBehaviour({
      document,
      matchMedia: reducedMotion(true),
    });

    expect(autoplayingVideo.pause).toHaveBeenCalledOnce();
    expect(autoplayingVideo.autoplay).toBe(false);
    expect(autoplayingVideo.hasAttribute("autoplay")).toBe(false);
    expect(staticVideo.pause).not.toHaveBeenCalled();
  });

  it("reveals an observed target once under normal motion", () => {
    document.body.innerHTML = `<article data-reveal>Observed once</article>`;
    const target = document.querySelector("[data-reveal]");
    const observerHarness = createObserverHarness();

    initializeSiteBehaviour({
      document,
      matchMedia: reducedMotion(false),
      IntersectionObserver: observerHarness.IntersectionObserver,
    });

    const observer = observerHarness.getInstance();
    expect(target.classList.contains("is-reveal-ready")).toBe(true);
    expect(target.classList.contains("is-visible")).toBe(false);
    expect(observer.observe).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledWith(target);

    observer.emit([{ target, isIntersecting: false }]);
    expect(target.classList.contains("is-visible")).toBe(false);

    observer.emit([{ target, isIntersecting: true }]);
    observer.emit([{ target, isIntersecting: true }]);

    expect(target.classList.contains("is-visible")).toBe(true);
    expect(observer.unobserve).toHaveBeenCalledOnce();
    expect(observer.unobserve).toHaveBeenCalledWith(target);
  });

  it("shows explicit targets when IntersectionObserver is unavailable", () => {
    document.body.innerHTML = `<div data-reveal>Fallback content</div>`;
    const target = document.querySelector("[data-reveal]");

    initializeSiteBehaviour({
      document,
      matchMedia: reducedMotion(false),
      IntersectionObserver: undefined,
    });

    expect(target.classList.contains("is-visible")).toBe(true);
    expect(target.classList.contains("is-reveal-ready")).toBe(false);
  });

  it("does not alter or observe elements without data-reveal", () => {
    document.body.innerHTML = `
      <div class="existing">Static content</div>
      <div class="existing" data-reveal>Reveal content</div>
    `;
    const [staticElement, revealElement] = document.querySelectorAll(".existing");
    const observerHarness = createObserverHarness();

    initializeSiteBehaviour({
      document,
      matchMedia: reducedMotion(false),
      IntersectionObserver: observerHarness.IntersectionObserver,
    });

    const observer = observerHarness.getInstance();
    expect(staticElement.className).toBe("existing");
    expect(observer.observe).not.toHaveBeenCalledWith(staticElement);
    expect(observer.observe).toHaveBeenCalledWith(revealElement);
  });
});
