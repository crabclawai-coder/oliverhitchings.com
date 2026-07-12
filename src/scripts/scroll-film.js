const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_SCRUB_WIDTH = 861;

function noOpController() {
  return { destroy() {} };
}

function safelyPause(video) {
  try {
    video.pause();
  } catch {
    // The poster remains visible when playback controls are unavailable.
  }
}

function safelyPlay(video) {
  try {
    video.play()?.catch?.(() => {});
  } catch {
    // The poster remains visible when fallback playback is unavailable.
  }
}

export function initializeScrollFilms({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  connection = globalThis.navigator?.connection,
  IntersectionObserver: IntersectionObserverImpl =
    globalThis.IntersectionObserver,
  requestAnimationFrame = windowRef?.requestAnimationFrame?.bind(windowRef),
  cancelAnimationFrame = windowRef?.cancelAnimationFrame?.bind(windowRef),
} = {}) {
  const video = documentRef?.querySelector("video[data-scroll-film]");

  if (!video) {
    return noOpController();
  }

  const prefersReducedMotion =
    typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;

  if (prefersReducedMotion || connection?.saveData) {
    video.dataset.scrollMode = "poster";
    safelyPause(video);
    return noOpController();
  }

  const region = video.closest("[data-scroll-film-region]");
  if (
    !region ||
    !windowRef ||
    windowRef.innerWidth < MIN_SCRUB_WIDTH ||
    typeof IntersectionObserverImpl !== "function" ||
    typeof requestAnimationFrame !== "function"
  ) {
    video.dataset.scrollMode = "loop";
    return noOpController();
  }

  video.dataset.scrollMode = "scrub";

  let destroyed = false;
  let frameId = null;
  let intersecting = false;
  let listenersAttached = false;
  let metadataListenerAttached = false;
  let observerDisconnected = false;

  const handleLoadedMetadata = () => {
    metadataListenerAttached = false;
    scheduleUpdate();
  };

  const waitForMetadata = () => {
    if (metadataListenerAttached) {
      return;
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata, {
      once: true,
    });
    metadataListenerAttached = true;
  };

  const removeMetadataListener = () => {
    if (!metadataListenerAttached) {
      return;
    }

    video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    metadataListenerAttached = false;
  };

  const cancelQueuedFrame = () => {
    if (frameId === null) {
      return;
    }

    cancelAnimationFrame?.(frameId);
    frameId = null;
  };

  const removeListeners = () => {
    if (!listenersAttached) {
      return;
    }

    windowRef.removeEventListener("scroll", scheduleUpdate);
    windowRef.removeEventListener("resize", scheduleUpdate);
    listenersAttached = false;
  };

  const disconnectObserver = () => {
    if (observerDisconnected) {
      return;
    }

    observer.disconnect();
    observerDisconnected = true;
  };

  const fallBackToLoop = () => {
    video.dataset.scrollMode = "loop";
    intersecting = false;
    removeListeners();
    removeMetadataListener();
    disconnectObserver();
    safelyPlay(video);
  };

  const updateFrame = () => {
    frameId = null;
    if (destroyed || !intersecting) {
      return;
    }

    const duration = video.duration;
    if (!Number.isFinite(duration)) {
      waitForMetadata();
      return;
    }
    removeMetadataListener();

    const rect = region.getBoundingClientRect();
    const progress = Math.min(
      1,
      Math.max(
        0,
        (windowRef.innerHeight - rect.top) /
          (windowRef.innerHeight + rect.height),
      ),
    );

    try {
      video.currentTime = progress * duration;
    } catch {
      fallBackToLoop();
    }
  };

  function scheduleUpdate() {
    if (destroyed || !intersecting || frameId !== null) {
      return;
    }

    frameId = requestAnimationFrame(updateFrame);
  }

  const addListeners = () => {
    if (listenersAttached) {
      return;
    }

    windowRef.addEventListener("scroll", scheduleUpdate, { passive: true });
    windowRef.addEventListener("resize", scheduleUpdate, { passive: true });
    listenersAttached = true;
  };

  const observer = new IntersectionObserverImpl((entries) => {
    if (destroyed) {
      return;
    }

    entries.forEach((entry) => {
      if (entry.target !== region) {
        return;
      }

      intersecting = entry.isIntersecting;
      if (intersecting) {
        addListeners();
        scheduleUpdate();
        return;
      }

      removeListeners();
      cancelQueuedFrame();
    });
  });

  observer.observe(region);

  return {
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      intersecting = false;
      removeListeners();
      removeMetadataListener();
      cancelQueuedFrame();
      disconnectObserver();
    },
  };
}
