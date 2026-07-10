const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function safelyPlay(video) {
  try {
    const playAttempt = video.play();

    if (playAttempt && typeof playAttempt.catch === "function") {
      playAttempt.catch(() => {});
    }
  } catch {
    // A poster remains visible when playback is unavailable.
  }
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
    media.forEach((video) => video.pause());
    return null;
  }

  const loadedMedia = new WeakSet();
  const visibleMedia = new WeakSet();

  const playVisibleMedia = (video) => {
    if (
      documentRef.hidden ||
      !loadedMedia.has(video) ||
      !visibleMedia.has(video)
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
    video.load();
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

  if (typeof IntersectionObserverImpl === "function") {
    const nearbyMedia = media.filter(
      (video) => video.dataset.mediaLoad === "nearby",
    );

    if (nearbyMedia.length > 0) {
      loadObserver = new IntersectionObserverImpl(
        (entries) => {
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
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleMedia.add(entry.target);
          playVisibleMedia(entry.target);
          return;
        }

        visibleMedia.delete(entry.target);
        if (loadedMedia.has(entry.target)) {
          entry.target.pause();
        }
      });
    });
    media.forEach((video) => visibilityObserver.observe(video));
  }

  documentRef.addEventListener("visibilitychange", () => {
    if (documentRef.hidden) {
      media
        .filter((video) => loadedMedia.has(video))
        .forEach((video) => video.pause());
      return;
    }

    media
      .filter(
        (video) => loadedMedia.has(video) && visibleMedia.has(video),
      )
      .forEach(safelyPlay);
  });

  return { loadObserver, visibilityObserver };
}
