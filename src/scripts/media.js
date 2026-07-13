const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function suppressRejection(attempt) {
  if (attempt && typeof attempt.catch === "function") {
    attempt.catch(() => {});
  }
}

function safelyPlay(video) {
  try {
    suppressRejection(video.play());
  } catch {
    // A poster remains visible when playback is unavailable.
  }
}

function safelyPause(video) {
  try {
    suppressRejection(video.pause());
  } catch {
    // A poster remains visible when playback controls are unavailable.
  }
}

function safelyLoad(video) {
  try {
    suppressRejection(video.load());
  } catch {
    // A poster remains visible when loading is unavailable.
  }
}

function canAutoplay(video) {
  return (
    video.dataset.mediaBehaviour !== "scroll" ||
    video.dataset.scrollMode === "loop"
  );
}

function promoteSources(video) {
  video.querySelectorAll("source[data-src]").forEach((source) => {
    if (!source.hasAttribute("src")) {
      source.setAttribute("src", source.dataset.src);
    }
  });
}

export function initializeMedia({
  document: documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  connection = globalThis.navigator?.connection,
  IntersectionObserver: IntersectionObserverImpl =
    globalThis.IntersectionObserver,
} = {}) {
  if (!documentRef) {
    return null;
  }

  const media = Array.from(documentRef.querySelectorAll("video[data-media]"));
  const prefersReducedMotion =
    typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;

  if (prefersReducedMotion || connection?.saveData) {
    media.forEach(safelyPause);
    return null;
  }

  const loadedMedia = new WeakSet();
  const visibleMedia = new WeakSet();
  let destroyed = false;

  const playVisibleMedia = (video) => {
    if (
      documentRef.hidden ||
      !loadedMedia.has(video) ||
      !visibleMedia.has(video) ||
      !canAutoplay(video)
    ) {
      return;
    }

    safelyPlay(video);
  };

  const loadMedia = (video) => {
    if (video.dataset.mediaLoaded === "true") {
      loadedMedia.add(video);
      return;
    }

    promoteSources(video);
    video.dataset.mediaLoaded = "true";
    loadedMedia.add(video);
    safelyLoad(video);
    playVisibleMedia(video);
  };

  media
    .filter((video) => video.dataset.mediaLoad === "eager")
    .forEach((video) => {
      visibleMedia.add(video);
      loadMedia(video);
    });

  let loadObserver = null;
  let visibilityObserver = null;

  if (typeof IntersectionObserverImpl !== "function") {
    media
      .filter(
        (video) =>
          video.dataset.mediaLoad === "nearby" && canAutoplay(video),
      )
      .forEach((video) => {
        visibleMedia.add(video);
        loadMedia(video);
      });
  } else {
    const nearbyMedia = media.filter(
      (video) => video.dataset.mediaLoad === "nearby",
    );

    if (nearbyMedia.length > 0) {
      loadObserver = new IntersectionObserverImpl(
        (entries) => {
          if (destroyed) {
            return;
          }

          entries.forEach((entry) => {
            if (!entry.isIntersecting) {
              return;
            }

            loadMedia(entry.target);
            loadObserver.unobserve(entry.target);
          });
        },
        { rootMargin: "320px 0px" },
      );
      nearbyMedia.forEach((video) => loadObserver.observe(video));
    }

    visibilityObserver = new IntersectionObserverImpl((entries) => {
      if (destroyed) {
        return;
      }

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleMedia.add(entry.target);
          playVisibleMedia(entry.target);
          return;
        }

        visibleMedia.delete(entry.target);
        if (loadedMedia.has(entry.target)) {
          safelyPause(entry.target);
        }
      });
    });
    media.forEach((video) => visibilityObserver.observe(video));
  }

  const handleVisibilityChange = () => {
    if (destroyed) {
      return;
    }

    if (documentRef.hidden) {
      media
        .filter((video) => loadedMedia.has(video))
        .forEach(safelyPause);
      return;
    }

    media
      .filter(
        (video) => loadedMedia.has(video) && visibleMedia.has(video),
      )
      .forEach(playVisibleMedia);
  };

  documentRef.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    loadObserver,
    visibilityObserver,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      loadObserver?.disconnect();
      visibilityObserver?.disconnect();
      documentRef.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      media.forEach(safelyPause);
    },
  };
}
