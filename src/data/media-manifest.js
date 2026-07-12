const MiB = 1024 * 1024;
const posterMaxBytes = 150 * 1024;
const mobileMedia = "(max-width: 640px)";

function variant(config) {
  return Object.freeze(config);
}

function landscapeVariants(id) {
  return Object.freeze({
    mobile: Object.freeze([
      variant({
        src: `/videos/${id}-960.webm`,
        codec: "av1",
        container: "webm",
        profile: "Main",
        media: mobileMedia,
        type: 'video/webm; codecs="av01.0.04M.08"',
        width: 960,
        height: 540,
      }),
      variant({
        src: `/videos/${id}-960.mp4`,
        codec: "h264",
        container: "mp4",
        profile: "High",
        level: 31,
        media: mobileMedia,
        type: 'video/mp4; codecs="avc1.64001f"',
        width: 960,
        height: 540,
      }),
    ]),
    desktop: Object.freeze([
      variant({
        src: `/videos/${id}-1280.webm`,
        codec: "av1",
        container: "webm",
        profile: "Main",
        media: null,
        type: 'video/webm; codecs="av01.0.05M.08"',
        width: 1280,
        height: 720,
      }),
      variant({
        src: `/videos/${id}-1280.mp4`,
        codec: "h264",
        container: "mp4",
        profile: "High",
        level: 40,
        media: null,
        type: 'video/mp4; codecs="avc1.640028"',
        width: 1280,
        height: 720,
      }),
    ]),
  });
}

function portraitVariants(id) {
  return Object.freeze({
    mobile: Object.freeze([
      variant({
        src: `/videos/${id}-480.webm`,
        codec: "av1",
        container: "webm",
        profile: "Main",
        media: mobileMedia,
        type: 'video/webm; codecs="av01.0.04M.08"',
        width: 480,
        height: 640,
      }),
      variant({
        src: `/videos/${id}-480.mp4`,
        codec: "h264",
        container: "mp4",
        profile: "High",
        level: 31,
        media: mobileMedia,
        type: 'video/mp4; codecs="avc1.64001f"',
        width: 480,
        height: 640,
      }),
    ]),
    desktop: Object.freeze([
      variant({
        src: `/videos/${id}-720.webm`,
        codec: "av1",
        container: "webm",
        profile: "Main",
        media: null,
        type: 'video/webm; codecs="av01.0.05M.08"',
        width: 720,
        height: 960,
      }),
      variant({
        src: `/videos/${id}-720.mp4`,
        codec: "h264",
        container: "mp4",
        profile: "High",
        level: 40,
        media: null,
        type: 'video/mp4; codecs="avc1.640028"',
        width: 720,
        height: 960,
      }),
    ]),
  });
}

function film(config) {
  return Object.freeze({
    ...config,
    poster: Object.freeze({
      src: `/images/posters/${config.id}.webp`,
      width: config.width,
      height: config.height,
      maxBytes: posterMaxBytes,
    }),
  });
}

export const motionFilms = Object.freeze({
  hero: film({
    durationSeconds: 8.04,
    gop: 240,
    height: 720,
    id: "hero",
    legacySource: null,
    orientation: "landscape",
    variants: landscapeVariants("hero"),
    width: 1280,
  }),
  process: film({
    durationSeconds: 8.04,
    gop: 24,
    height: 720,
    id: "process",
    legacySource: "process.mp4",
    orientation: "landscape",
    variants: landscapeVariants("process"),
    width: 1280,
  }),
  bento: film({
    durationSeconds: 9.04,
    gop: 240,
    height: 960,
    id: "bento",
    legacySource: "bento.mp4",
    orientation: "portrait",
    variants: portraitVariants("bento"),
    width: 720,
  }),
  "feature-card": film({
    durationSeconds: 8.04,
    gop: 240,
    height: 960,
    id: "feature-card",
    legacySource: "feature-card.mp4",
    orientation: "portrait",
    variants: portraitVariants("feature-card"),
    width: 720,
  }),
  "cta-footer": film({
    durationSeconds: 8.04,
    gop: 240,
    height: 720,
    id: "cta-footer",
    legacySource: "cta-footer.mp4",
    orientation: "landscape",
    variants: landscapeVariants("cta-footer"),
    width: 1280,
  }),
});

export const restoredFilmIds = Object.freeze([
  "process",
  "bento",
  "feature-card",
  "cta-footer",
]);

export const mediaRoutes = Object.freeze({
  home: Object.freeze(["hero", "process", "bento", "feature-card", "cta-footer"]),
  services: Object.freeze(["process", "feature-card"]),
  about: Object.freeze(["feature-card"]),
  blog: Object.freeze(["cta-footer"]),
});

export const mediaBudgets = Object.freeze({
  inventory: 24 * MiB,
  initialDesktop: 2.5 * MiB,
  initialMobile: 1.75 * MiB,
  routes: Object.freeze({
    home: 8 * MiB,
    services: 4 * MiB,
    about: 3 * MiB,
    blog: 3 * MiB,
  }),
});

export function getMotionFilm(id) {
  const filmData = motionFilms[id];
  if (!filmData) throw new RangeError(`Unknown motion film: ${id}`);
  return filmData;
}
