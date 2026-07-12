const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function initializeSiteBehaviour({
  document: documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  IntersectionObserver: IntersectionObserverImpl =
    globalThis.IntersectionObserver,
} = {}) {
  if (!documentRef) {
    return null;
  }

  const revealTargets = Array.from(
    documentRef.querySelectorAll("[data-reveal]"),
  );
  const prefersReducedMotion =
    typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;

  if (prefersReducedMotion) {
    revealTargets.forEach((target) => target.classList.add("is-visible"));

    documentRef.querySelectorAll("video").forEach((video) => {
      if (!video.autoplay && !video.hasAttribute("autoplay")) {
        return;
      }

      video.pause();
      video.autoplay = false;
      video.removeAttribute("autoplay");
    });

    return null;
  }

  if (
    revealTargets.length === 0 ||
    typeof IntersectionObserverImpl !== "function"
  ) {
    revealTargets.forEach((target) => target.classList.add("is-visible"));
    return null;
  }

  revealTargets.forEach((target) =>
    target.classList.add("is-reveal-ready"),
  );

  const observer = new IntersectionObserverImpl(
    (entries) => {
      entries.forEach((entry) => {
        if (
          !entry.isIntersecting ||
          entry.target.classList.contains("is-visible")
        ) {
          return;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );

  revealTargets.forEach((target) => observer.observe(target));
  return observer;
}
