# Cinematic Motion Restoration and Structural Clean-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the four recovered cinematic films, add one viewport-scoped homepage scrub sequence, and clean the current site's mobile navigation and editorial rhythm without changing production or the enquiry backend.

**Architecture:** A shared media manifest is the source of truth for rendering, deterministic generation, metadata validation, and route transfer budgets. `MotionFilm.astro` renders every hero and restored film, `media.js` owns loading and visibility, `scroll-film.js` owns only desktop scroll-to-playhead mapping, and `mobile-navigation.js` owns only the compact menu. Page files choose placement; `global.css` controls composition and breakpoints.

**Tech Stack:** Astro 6.1.7, JavaScript ES modules, Vitest 4.1.10 with jsdom, FFmpeg/ffprobe, `libsvtav1`, `libx264`, `cwebp`, Git history, and the existing local Astro preview server.

## Global Constraints

- Work only on `codex/cinematic-restoration`; do not push, merge, deploy, publish a Worker, change DNS, or alter Cloudflare/Resend configuration.
- Keep `contact-worker/`, `src/scripts/contact-form.js`, `src/scripts/turnstile.js`, their tests, the Worker route, and the form field contract unchanged.
- Recover source films from commit `26200b9`; its four film blobs are byte-identical to the copies at `87c3bdd`.
- Preserve the homepage initial media path at no more than 2.5 MiB desktop and 1.75 MiB mobile.
- Enforce route transfer limits of 8 MiB Home, 4 MiB Services, 3 MiB About, and 3 MiB Field Notes, using the larger selected WebM/MP4 rendition plus one poster per unique film.
- Keep every poster at or below 150 KiB and the complete tracked media inventory at or below 24 MiB.
- All films are silent, 24 fps, yuv420p, have no direct `src`, and expose no information unavailable in HTML.
- Reduced-motion and Save-Data visitors receive posters only; below-fold media uses nearby loading and pauses off-screen or while the document is hidden.
- The homepage process film is the only scroll-responsive film, and only at widths of 861 CSS pixels or more.
- The local preview defaults to port 4321 and must not submit the enquiry form.
- Production at `https://oliverhitchings.com` remains unchanged.

---

## File Responsibility Map

- Create `src/data/media-manifest.js`: authoritative film metadata, responsive sources, route membership, and budgets.
- Create `src/data/media-manifest.test.js`: manifest shape, exact inventory, route membership, and lookup behaviour.
- Create `src/components/MotionFilm.astro`: poster, decorative video, deferred sources, lifecycle attributes, and optional caption slot.
- Create `scripts/generate-motion-media.mjs`: deterministic extraction and transcoding from Git history.
- Create `src/media-generation.test.js`: generator argument and source-commit contract.
- Modify `scripts/check-media-budget.mjs`: manifest-driven inventory, metadata, seekability, poster, and transfer-budget checks.
- Modify `src/scripts/media.js` and `src/scripts/media.test.js`: safe loop/scrub coordination and teardown.
- Create `src/scripts/scroll-film.js` and `src/scripts/scroll-film.test.js`: viewport eligibility and scroll-progress mapping.
- Create `src/scripts/mobile-navigation.js` and `src/scripts/mobile-navigation.test.js`: compact-menu state and accessible teardown.
- Modify `src/layouts/BaseLayout.astro`: initialise and clean up independent controllers in a fixed order.
- Modify `src/components/Header.astro`: progressive-enhancement desktop and mobile navigation markup.
- Modify `src/pages/index.astro`, `services.astro`, `about.astro`, and `blog.astro`: exact motion placements and proof labels.
- Modify `src/styles/global.css`: generic film presentation, page composition, compact navigation, section tokens, crops, and responsive rhythm.
- Modify `src/pages-content.output.test.js` and `src/site-frame.output.test.js`: route-to-film, media, contact-isolation, navigation, and stylesheet contracts.

### Task 1: Establish the media manifest and reusable renderer

**Files:**
- Create: `src/data/media-manifest.js`
- Create: `src/data/media-manifest.test.js`
- Create: `src/components/MotionFilm.astro`
- Modify: `src/pages/index.astro:1-40`
- Modify: `src/pages-content.output.test.js:20-44, 747-808`
- Modify: `src/styles/global.css:737-763`

**Interfaces:**
- Produces: `motionFilms`, `mediaBudgets`, `mediaRoutes`, `restoredFilmIds`, and `getMotionFilm(id)`.
- Produces: `<MotionFilm film loading behaviour class videoClass />`.
- Consumes: existing hero files and poster; restored binaries arrive in Task 2.

- [ ] **Step 1: Write the failing manifest tests**

Create `src/data/media-manifest.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  getMotionFilm,
  mediaBudgets,
  mediaRoutes,
  motionFilms,
  restoredFilmIds,
} from "./media-manifest.js";

describe("media manifest", () => {
  it("defines the exact film inventory", () => {
    expect(Object.keys(motionFilms)).toEqual([
      "hero",
      "process",
      "bento",
      "feature-card",
      "cta-footer",
    ]);
    expect(restoredFilmIds).toEqual([
      "process",
      "bento",
      "feature-card",
      "cta-footer",
    ]);
    for (const film of Object.values(motionFilms)) {
      expect(film.variants.mobile).toHaveLength(2);
      expect(film.variants.desktop).toHaveLength(2);
      expect(film.poster.src).toMatch(/^\/images\/posters\/.+\.webp$/);
      expect(film.poster.maxBytes).toBe(150 * 1024);
    }
  });

  it("maps only approved unique films to each route", () => {
    expect(mediaRoutes).toEqual({
      home: ["hero", "process", "bento", "feature-card", "cta-footer"],
      services: ["process", "feature-card"],
      about: ["feature-card"],
      blog: ["cta-footer"],
    });
    expect(mediaBudgets).toMatchObject({
      inventory: 24 * 1024 * 1024,
      initialDesktop: 2.5 * 1024 * 1024,
      initialMobile: 1.75 * 1024 * 1024,
      routes: {
        home: 8 * 1024 * 1024,
        services: 4 * 1024 * 1024,
        about: 3 * 1024 * 1024,
        blog: 3 * 1024 * 1024,
      },
    });
  });

  it("returns known films and rejects unknown identities", () => {
    expect(getMotionFilm("process")).toBe(motionFilms.process);
    expect(() => getMotionFilm("missing")).toThrow(
      "Unknown motion film: missing",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npx vitest run src/data/media-manifest.test.js`

Expected: FAIL because `src/data/media-manifest.js` does not exist.

- [ ] **Step 3: Implement the complete shared manifest**

Create `src/data/media-manifest.js`. Use `MiB = 1024 * 1024`, poster limit `150 * 1024`, and mobile media query `(max-width: 640px)`. Define immutable `variant`, `landscapeVariants`, `portraitVariants`, and `film` helpers.

```js
const MiB = 1024 * 1024;
const posterMaxBytes = 150 * 1024;
const mobileMedia = "(max-width: 640px)";

function variant(config) {
  return Object.freeze(config);
}

function landscapeVariants(id) {
  return Object.freeze({
    mobile: Object.freeze([
      variant({ src: `/videos/${id}-960.webm`, codec: "av1", container: "webm", profile: "Main", media: mobileMedia, type: 'video/webm; codecs="av01.0.04M.08"', width: 960, height: 540 }),
      variant({ src: `/videos/${id}-960.mp4`, codec: "h264", container: "mp4", profile: "High", level: 31, media: mobileMedia, type: 'video/mp4; codecs="avc1.64001f"', width: 960, height: 540 }),
    ]),
    desktop: Object.freeze([
      variant({ src: `/videos/${id}-1280.webm`, codec: "av1", container: "webm", profile: "Main", media: null, type: 'video/webm; codecs="av01.0.05M.08"', width: 1280, height: 720 }),
      variant({ src: `/videos/${id}-1280.mp4`, codec: "h264", container: "mp4", profile: "High", level: 40, media: null, type: 'video/mp4; codecs="avc1.640028"', width: 1280, height: 720 }),
    ]),
  });
}

function portraitVariants(id) {
  return Object.freeze({
    mobile: Object.freeze([
      variant({ src: `/videos/${id}-480.webm`, codec: "av1", container: "webm", profile: "Main", media: mobileMedia, type: 'video/webm; codecs="av01.0.04M.08"', width: 480, height: 640 }),
      variant({ src: `/videos/${id}-480.mp4`, codec: "h264", container: "mp4", profile: "High", level: 31, media: mobileMedia, type: 'video/mp4; codecs="avc1.64001f"', width: 480, height: 640 }),
    ]),
    desktop: Object.freeze([
      variant({ src: `/videos/${id}-720.webm`, codec: "av1", container: "webm", profile: "Main", media: null, type: 'video/webm; codecs="av01.0.05M.08"', width: 720, height: 960 }),
      variant({ src: `/videos/${id}-720.mp4`, codec: "h264", container: "mp4", profile: "High", level: 40, media: null, type: 'video/mp4; codecs="avc1.640028"', width: 720, height: 960 }),
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
```

The five exact records are:

```js
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
```

`landscapeVariants(id)` returns mobile `960x540` and desktop `1280x720` AV1 WebM/H.264 MP4 entries. `portraitVariants(id)` returns mobile `480x640` and desktop `720x960` entries. Each entry contains `src`, `codec`, `container`, `profile`, H.264 `level`, `media`, `type`, `width`, and `height`.

Export these exact route and budget objects:

```js
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
```

- [ ] **Step 4: Add the reusable Astro renderer**

Create `src/components/MotionFilm.astro`:

```astro
---
import { getMotionFilm } from "../data/media-manifest.js";

const {
  film,
  loading = "nearby",
  behaviour = "loop",
  class: className,
  videoClass,
} = Astro.props;

if (!["eager", "nearby"].includes(loading)) {
  throw new RangeError(`Unknown media loading mode: ${loading}`);
}
if (!["loop", "scroll"].includes(behaviour)) {
  throw new RangeError(`Unknown media behaviour: ${behaviour}`);
}

const filmData = getMotionFilm(film);
const sources = [...filmData.variants.mobile, ...filmData.variants.desktop];
const hasCaption = Astro.slots.has("caption");
---

<figure
  class:list={["motion-film", `motion-film--${filmData.orientation}`, className]}
  data-motion-film={filmData.id}
>
  <img
    class="motion-film__poster"
    src={filmData.poster.src}
    width={filmData.poster.width}
    height={filmData.poster.height}
    loading={loading === "eager" ? "eager" : "lazy"}
    fetchpriority={loading === "eager" ? "high" : undefined}
    alt=""
    aria-hidden="true"
  />
  <video
    class:list={["motion-film__video", videoClass]}
    width={filmData.width}
    height={filmData.height}
    muted
    loop
    playsinline
    preload="none"
    aria-hidden="true"
    tabindex="-1"
    data-media
    data-media-load={loading}
    data-media-behaviour={behaviour}
    data-scroll-film={behaviour === "scroll" ? "true" : undefined}
  >
    {sources.map((source) => (
      <source
        data-src={source.src}
        type={source.type}
        media={source.media ?? undefined}
      />
    ))}
  </video>
  {hasCaption && (
    <figcaption class="motion-film__caption"><slot name="caption" /></figcaption>
  )}
</figure>
```

Refactor only the literal homepage hero video to:

```astro
<MotionFilm
  film="hero"
  loading="eager"
  behaviour="loop"
  class="home-hero__media"
  videoClass="home-hero__video"
/>
```

Add generic `.motion-film`, poster, video, and caption CSS. Make `.home-hero__media` absolute/inset/z-index `-2`; preserve the current opacity, crop, saturation, and contrast on `.home-hero__video`.

Update hero output tests to assert the eager poster image, decorative video, and exact four deferred sources.

- [ ] **Step 5: Run the focused and output tests**

Run: `npx vitest run src/data/media-manifest.test.js src/pages-content.output.test.js`

Expected: PASS, with exactly one current homepage film.

- [ ] **Step 6: Commit**

```bash
git add src/data/media-manifest.js src/data/media-manifest.test.js src/components/MotionFilm.astro src/pages/index.astro src/pages-content.output.test.js src/styles/global.css
git commit -m "feat: add reusable cinematic media manifest"
```

### Task 2: Generate restored assets and enforce transfer budgets

**Files:**
- Create: `scripts/generate-motion-media.mjs`
- Create: `src/media-generation.test.js`
- Modify: `scripts/check-media-budget.mjs`
- Modify: `src/scripts/media.test.js`
- Modify: `package.json:6-13`
- Create: 16 restored variants under `public/videos/`
- Create: 4 restored posters under `public/images/posters/`

**Interfaces:**
- Consumes: manifest records from Task 1.
- Produces: `SOURCE_COMMIT`, `buildVideoArguments`, `buildPosterArguments`, `generateMotionMedia`, and `runMediaGeneratorCli`.
- Produces: `calculateTransferBudgets` and the existing checker exports.

- [ ] **Step 1: Write failing generator tests**

Create `src/media-generation.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  SOURCE_COMMIT,
  buildPosterArguments,
  buildVideoArguments,
} from "../scripts/generate-motion-media.mjs";
import { motionFilms } from "./data/media-manifest.js";

describe("motion media generator", () => {
  it("pins the historical source", () => {
    expect(SOURCE_COMMIT).toBe("26200b9");
  });

  it("uses one-second keyframes for the process MP4", () => {
    const args = buildVideoArguments({
      film: motionFilms.process,
      sourcePath: "/tmp/process.mp4",
      variant: motionFilms.process.variants.desktop[1],
      outputPath: "/tmp/process-1280.mp4",
    });
    expect(args).toEqual(expect.arrayContaining([
      "-c:v", "libx264", "-g", "24", "-keyint_min", "24",
      "-sc_threshold", "0", "-movflags", "+faststart",
    ]));
  });

  it("uses AV1 for WebM and a bounded poster target", () => {
    const videoArgs = buildVideoArguments({
      film: motionFilms.bento,
      sourcePath: "/tmp/bento.mp4",
      variant: motionFilms.bento.variants.mobile[0],
      outputPath: "/tmp/bento-480.webm",
    });
    const posterArgs = buildPosterArguments({
      inputPath: "/tmp/bento.png",
      outputPath: "/tmp/bento.webp",
    });
    expect(videoArgs).toEqual(expect.arrayContaining(["-c:v", "libsvtav1"]));
    expect(posterArgs).toEqual(expect.arrayContaining([
      "-size", String(140 * 1024),
    ]));
  });
});
```

Add one `calculateTransferBudgets` test to `src/scripts/media.test.js` with explicit `Map` instances. Assert unique-route de-duplication and the larger selected WebM/MP4 size.

Refactor the existing oversized-media fixture to create every video/poster filename derived from `motionFilms`, not only the four hero videos. Make its injected ffprobe executor return manifest-matching metadata by filename, then override one chosen process file and one poster to preserve the existing controlled failure assertions.

- [ ] **Step 2: Run tests and confirm missing exports**

Run: `npx vitest run src/media-generation.test.js src/scripts/media.test.js`

Expected: FAIL because the generator and transfer calculator do not exist.

- [ ] **Step 3: Implement the deterministic generator**

Create `scripts/generate-motion-media.mjs` with:

```js
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { motionFilms, restoredFilmIds } from "../src/data/media-manifest.js";

export const SOURCE_COMMIT = "26200b9";
const modulePath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(modulePath), "..");

function scaleFilter(width, height) {
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24,format=yuv420p`;
}

export function buildVideoArguments({ film, sourcePath, variant, outputPath }) {
  const desktop = variant.media === null;
  const common = [
    "-y", "-i", sourcePath, "-an", "-vf",
    scaleFilter(variant.width, variant.height),
    "-r", "24", "-g", String(film.gop), "-pix_fmt", "yuv420p",
  ];
  if (variant.container === "webm") {
    return [
      ...common, "-c:v", "libsvtav1", "-preset", "6",
      "-crf", desktop ? "36" : "38", outputPath,
    ];
  }
  return [
    ...common, "-c:v", "libx264", "-preset", "slow",
    "-crf", desktop ? "26" : "28", "-profile:v", "high",
    "-level:v", variant.level === 40 ? "4.0" : "3.1",
    "-keyint_min", String(film.gop), "-sc_threshold", "0",
    "-movflags", "+faststart", outputPath,
  ];
}

export function buildPosterArguments({ inputPath, outputPath }) {
  return [
    "-quiet", "-q", "78", "-size", String(140 * 1024),
    inputPath, "-o", outputPath,
  ];
}

export async function generateMotionMedia({
  projectRoot = defaultRoot,
  runner = execFileSync,
  logger = console,
} = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "oh-motion-media-"));
  const videoDirectory = join(projectRoot, "public/videos");
  const posterDirectory = join(projectRoot, "public/images/posters");
  await mkdir(videoDirectory, { recursive: true });
  await mkdir(posterDirectory, { recursive: true });
  let videoCount = 0;
  let posterCount = 0;

  try {
    for (const filmId of restoredFilmIds) {
      const film = motionFilms[filmId];
      const sourcePath = join(temporaryRoot, film.legacySource);
      const source = runner(
        "git",
        ["show", `${SOURCE_COMMIT}:public/videos/${film.legacySource}`],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      await writeFile(sourcePath, source);

      for (const variant of [
        ...film.variants.mobile,
        ...film.variants.desktop,
      ]) {
        const outputPath = join(videoDirectory, basename(variant.src));
        runner(
          "ffmpeg",
          buildVideoArguments({ film, sourcePath, variant, outputPath }),
          { stdio: "inherit" },
        );
        videoCount += 1;
      }

      const posterPng = join(temporaryRoot, `${film.id}.png`);
      runner(
        "ffmpeg",
        [
          "-y", "-ss", "1", "-i", sourcePath, "-frames:v", "1",
          "-vf", scaleFilter(film.width, film.height), posterPng,
        ],
        { stdio: "inherit" },
      );
      runner(
        "cwebp",
        buildPosterArguments({
          inputPath: posterPng,
          outputPath: join(posterDirectory, `${film.id}.webp`),
        }),
        { stdio: "inherit" },
      );
      posterCount += 1;
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }

  logger.log(`Generated ${videoCount} video variants and ${posterCount} posters.`);
  return { posterCount, videoCount };
}

export async function runMediaGeneratorCli(options) {
  return generateMotionMedia(options);
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  await runMediaGeneratorCli();
}
```

Add `"generate:motion-media": "node scripts/generate-motion-media.mjs"` to package scripts.

- [ ] **Step 4: Make the checker manifest-driven**

In `scripts/check-media-budget.mjs`, derive expected videos/posters from the manifest instead of hard-coded hero names. Retain `inspectMediaDirectory`, `validateFrameRates`, `checkMediaBudget`, and `runMediaBudgetCli`.

```js
import { basename } from "node:path";
import {
  mediaBudgets,
  mediaRoutes,
  motionFilms,
} from "../src/data/media-manifest.js";

const expectedVideos = Object.values(motionFilms).flatMap((film) =>
  [...film.variants.mobile, ...film.variants.desktop].map((source) => ({
    ...source,
    durationSeconds: film.durationSeconds,
    filmId: film.id,
    gop: film.gop,
    name: basename(source.src),
  })),
);

const expectedPosters = Object.values(motionFilms).map((film) => ({
  ...film.poster,
  filmId: film.id,
  name: basename(film.poster.src),
}));
```

Add:

```js
export function calculateTransferBudgets({
  manifest = motionFilms,
  routes = mediaRoutes,
  videoSizes,
  posterSizes,
}) {
  const selectedBytes = (filmId, rendition) => {
    const film = manifest[filmId];
    const videoBytes = Math.max(
      ...film.variants[rendition].map(
        ({ src }) => videoSizes.get(basename(src)) ?? 0,
      ),
    );
    return (
      videoBytes +
      (posterSizes.get(basename(film.poster.src)) ?? 0)
    );
  };

  return {
    initialDesktop: selectedBytes("hero", "desktop"),
    initialMobile: selectedBytes("hero", "mobile"),
    ...Object.fromEntries(
      Object.entries(routes).map(([route, ids]) => [
        route,
        [...new Set(ids)].reduce(
          (total, id) => total + selectedBytes(id, "desktop"),
          0,
        ),
      ]),
    ),
  };
}
```

Verify every codec, container, profile, resolution, duration, 24fps, yuv420p, no-audio contract, and poster dimensions. For each process variant, run ffprobe with `-select_streams v:0 -skip_frame nokey -show_entries frame=best_effort_timestamp_time -of json`, sort finite timestamps, and reject any adjacent gap over 1.05 seconds. Enforce inventory, initial and route budgets from `mediaBudgets`; return `{ errors, inventoryBytes, posterBytes, transfers }`.

```js
enforceBudget(errors, "Tracked media inventory", inventoryBytes, mediaBudgets.inventory);
enforceBudget(errors, "Initial desktop media path", transfers.initialDesktop, mediaBudgets.initialDesktop);
enforceBudget(errors, "Initial mobile media path", transfers.initialMobile, mediaBudgets.initialMobile);
for (const [route, limit] of Object.entries(mediaBudgets.routes)) {
  enforceBudget(errors, `${route} media path`, transfers[route], limit);
}
```

- [ ] **Step 5: Generate and verify assets**

Run: `npm run generate:motion-media`

Expected: `Generated 16 video variants and 4 posters.`

Run: `npx vitest run src/media-generation.test.js src/scripts/media.test.js`

Expected: PASS.

Run: `node scripts/check-media-budget.mjs`

Expected: PASS. If encoding exceeds a fixed budget, change only the generator CRF values; do not raise any budget.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/generate-motion-media.mjs scripts/check-media-budget.mjs src/media-generation.test.js src/scripts/media.test.js public/videos public/images/posters
git commit -m "feat: restore optimised cinematic media"
```

### Task 3: Coordinate the media loader with scroll films

**Files:**
- Modify: `src/scripts/media.js`
- Modify: `src/scripts/media.test.js`

**Interfaces:**
- Consumes: `data-media-behaviour="loop|scroll"` and `data-scroll-mode="scrub|loop|poster"`.
- Produces: `{ loadObserver, visibilityObserver, destroy }`.

- [ ] **Step 1: Add failing loader tests**

Add cases proving scrub media loads but does not play, loop fallback plays, thrown `load()`/`pause()` calls do not escape, and `destroy()` disconnects observers/listeners.

Core assertion:

```js
video.dataset.mediaBehaviour = "scroll";
video.dataset.scrollMode = "scrub";
initialize({ IntersectionObserver: observerHarness.IntersectionObserver });
observerHarness.getVisibilityObserver().emit([
  { target: video, isIntersecting: true },
]);
expect(video.load).toHaveBeenCalledOnce();
expect(video.play).not.toHaveBeenCalled();
```

- [ ] **Step 2: Confirm failures**

Run: `npx vitest run src/scripts/media.test.js`

Expected: FAIL because scrub media autoplays and no teardown exists.

- [ ] **Step 3: Implement safe gating and teardown**

Add:

```js
function safelyPause(video) {
  try { video.pause(); } catch {}
}

function canAutoplay(video) {
  return (
    video.dataset.mediaBehaviour !== "scroll" ||
    video.dataset.scrollMode === "loop"
  );
}
```

Require `canAutoplay(video)` inside `playVisibleMedia`. Wrap `video.load()` and all pauses safely. Name the visibility handler and return:

```js
return {
  loadObserver,
  visibilityObserver,
  destroy() {
    loadObserver?.disconnect();
    visibilityObserver?.disconnect();
    documentRef.removeEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    media.forEach(safelyPause);
  },
};
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/scripts/media.test.js`

Expected: PASS.

```bash
git add src/scripts/media.js src/scripts/media.test.js
git commit -m "feat: coordinate cinematic media playback"
```

### Task 4: Add the viewport-scoped scroll controller

**Files:**
- Create: `src/scripts/scroll-film.js`
- Create: `src/scripts/scroll-film.test.js`
- Modify: `src/layouts/BaseLayout.astro:101-107`
- Modify: `src/site-frame.output.test.js:295-335`

**Interfaces:**
- Consumes: one `[data-scroll-film]` video inside `[data-scroll-film-region]`.
- Produces: `initializeScrollFilms(options)` returning `{ destroy }`.
- Sets scroll mode before `initializeMedia()` runs.

- [ ] **Step 1: Write failing controller tests**

Use jsdom fixtures with video duration 8 seconds, viewport height 900px, deterministic region rectangles and injected observer/RAF. Test width 861 => scrub, width 860 => loop, reduced motion/Save-Data => poster, intersection-only listeners, one RAF per burst, clamped 0/0.5/1 progress, seek failure => loop, and teardown.

Run: `npx vitest run src/scripts/scroll-film.test.js`

Expected: FAIL because the module is absent.

- [ ] **Step 2: Implement the isolated controller**

Create `src/scripts/scroll-film.js` with constants:

```js
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const MIN_SCRUB_WIDTH = 861;
```

`initializeScrollFilms()` must:

1. Find `video[data-scroll-film]`.
2. Set `poster` and pause for reduced motion/Save-Data.
3. Set `loop` below 861px or without IntersectionObserver.
4. Set `scrub` at eligible widths.
5. Observe the containing region.
6. Attach passive scroll/resize listeners only while intersecting.
7. Queue at most one RAF.
8. Calculate:

```js
const progress = Math.min(
  1,
  Math.max(
    0,
    (windowRef.innerHeight - rect.top) /
      (windowRef.innerHeight + rect.height),
  ),
);
video.currentTime = progress * video.duration;
```

9. On seek failure set mode `loop` and call `video.play()?.catch?.(() => {})`.
10. Disconnect observers, events and RAF in `destroy()`.

- [ ] **Step 3: Initialise it before general media**

In BaseLayout:

```js
import { initializeMedia } from "../scripts/media.js";
import { initializeScrollFilms } from "../scripts/scroll-film.js";
import { initializeSiteBehaviour } from "../scripts/site-behaviour.js";

const scrollFilms = initializeScrollFilms();
initializeSiteBehaviour();
const media = initializeMedia();

window.addEventListener("pagehide", () => {
  scrollFilms.destroy();
  media?.destroy?.();
}, { once: true });
```

Extend the same-origin output test to require scroll-film and media initialisers in external bundled modules.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/scripts/scroll-film.test.js src/scripts/media.test.js src/site-frame.output.test.js`

Expected: PASS.

```bash
git add src/scripts/scroll-film.js src/scripts/scroll-film.test.js src/layouts/BaseLayout.astro src/site-frame.output.test.js
git commit -m "feat: add scroll-responsive process controller"
```

### Task 5: Add accessible compact mobile navigation

**Files:**
- Create: `src/scripts/mobile-navigation.js`
- Create: `src/scripts/mobile-navigation.test.js`
- Modify: `src/components/Header.astro:5-35`
- Modify: `src/layouts/BaseLayout.astro:101-115`
- Modify: `src/site-frame.output.test.js:190-335`
- Modify: `src/styles/global.css:173-258, 616-684`

**Interfaces:**
- Consumes: navigation, toggle, controlled panel, mobile actions, desktop fallbacks.
- Produces: `initializeMobileNavigation(options)` returning `{ destroy }`.

- [ ] **Step 1: Write failing state-machine tests**

Test initial closed state, first/second toggle, link close, mobile CTA close, outside pointer close without focus movement, Escape close with focus return, breakpoint reset, and incomplete-markup no-op.

Add output assertions for `aria-controls="mobile-primary-navigation"`, matching panel ID, four exact links in each set, unchanged contact destination and 44px controls.

Run: `npx vitest run src/scripts/mobile-navigation.test.js src/site-frame.output.test.js`

Expected: FAIL.

- [ ] **Step 2: Implement the controller**

Create `src/scripts/mobile-navigation.js`:

```js
const MOBILE_QUERY = "(max-width: 620px)";

export function initializeMobileNavigation({
  document: documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
} = {}) {
  const navigation = documentRef?.querySelector("[data-mobile-navigation]");
  const toggle = navigation?.querySelector("[data-mobile-menu-toggle]");
  const panel = navigation?.querySelector("[data-mobile-menu-panel]");
  const actions = navigation?.querySelector("[data-mobile-navigation-actions]");

  if (
    !navigation ||
    !toggle ||
    !panel ||
    !actions ||
    typeof matchMedia !== "function"
  ) {
    return { destroy() {} };
  }

  const mobile = matchMedia(MOBILE_QUERY);
  const close = ({ focusToggle = false } = {}) => {
    navigation.classList.remove("is-mobile-navigation-open");
    toggle.setAttribute("aria-expanded", "false");
    if (focusToggle) toggle.focus();
  };
  const sync = () => {
    close();
    navigation.classList.toggle(
      "is-mobile-navigation-ready",
      mobile.matches,
    );
  };
  const onToggle = () => {
    const opening = !navigation.classList.contains(
      "is-mobile-navigation-open",
    );
    navigation.classList.toggle("is-mobile-navigation-open", opening);
    toggle.setAttribute("aria-expanded", String(opening));
  };
  const onNavigationClick = (event) => {
    if (event.target.closest("a")) close();
  };
  const onPointerDown = (event) => {
    if (!navigation.contains(event.target)) close();
  };
  const onKeyDown = (event) => {
    if (
      event.key !== "Escape" ||
      !navigation.classList.contains("is-mobile-navigation-open")
    ) return;
    event.preventDefault();
    event.stopPropagation();
    close({ focusToggle: true });
  };

  toggle.addEventListener("click", onToggle);
  panel.addEventListener("click", onNavigationClick);
  actions.addEventListener("click", onNavigationClick);
  documentRef.addEventListener("pointerdown", onPointerDown);
  documentRef.addEventListener("keydown", onKeyDown);
  mobile.addEventListener?.("change", sync);
  sync();

  return {
    destroy() {
      close();
      navigation.classList.remove("is-mobile-navigation-ready");
      toggle.removeEventListener("click", onToggle);
      panel.removeEventListener("click", onNavigationClick);
      actions.removeEventListener("click", onNavigationClick);
      documentRef.removeEventListener("pointerdown", onPointerDown);
      documentRef.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener?.("change", sync);
    },
  };
}
```

- [ ] **Step 3: Add progressive-enhancement markup**

Render both desktop and mobile links from the existing one `links` array. Add hooks:

```js
const normalisePath = (value) => value.replace(/\/$/, "") || "/";
const isActive = (link) => currentPath === normalisePath(link.href);
```

```astro
<nav class="nav-pill" aria-label="Primary navigation" data-mobile-navigation>
  <a class="brand-mark brand-lockup" href="/" aria-label="Oliver Hitchings home">
    <Logo />
    <span class="brand-name">{site.name}</span>
  </a>

  <div class="nav-links" data-desktop-navigation-links>
    {links.map((link) => (
      <a href={link.href} aria-current={isActive(link) ? "page" : undefined}>
        {link.label}
      </a>
    ))}
  </div>
  <a class="nav-cta" href={site.cta.contact.href} data-desktop-navigation-cta>
    {site.cta.contact.label}
  </a>

  <div class="mobile-navigation-actions" data-mobile-navigation-actions>
    <a class="nav-cta mobile-nav-cta" href={site.cta.contact.href}>
      {site.cta.contact.label}
    </a>
    <button
      class="mobile-menu-toggle"
      type="button"
      aria-expanded="false"
      aria-controls="mobile-primary-navigation"
      data-mobile-menu-toggle
    >Menu</button>
  </div>

  <div
    id="mobile-primary-navigation"
    class="mobile-navigation-panel"
    data-mobile-menu-panel
  >
    {links.map((link) => (
      <a href={link.href} aria-current={isActive(link) ? "page" : undefined}>
        {link.label}
      </a>
    ))}
  </div>
</nav>
```

Use the one `isActive` helper and the single existing `links` array for both groups.

- [ ] **Step 4: Add compact CSS and orchestration**

Hide mobile controls by default. At 620px and below, only under `.is-mobile-navigation-ready`, hide desktop links/CTA, display one row `brand actions`, and display a two-column panel only when open. All controls stay at least 44px. Hide visible `.brand-name` below 420px but retain the accessible brand label. Disable menu transitions under reduced motion.

Import and initialise navigation before scroll/media in BaseLayout and add `navigation.destroy()` to pagehide cleanup.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/scripts/mobile-navigation.test.js src/site-frame.output.test.js src/scripts/site-behaviour.test.js`

Expected: PASS.

```bash
git add src/scripts/mobile-navigation.js src/scripts/mobile-navigation.test.js src/components/Header.astro src/layouts/BaseLayout.astro src/site-frame.output.test.js src/styles/global.css
git commit -m "feat: add accessible compact mobile navigation"
```

### Task 6: Restore homepage cinematic chapters

**Files:**
- Modify: `src/pages/index.astro:101-299`
- Modify: `src/pages-content.output.test.js:294-435, 694-850`
- Modify: `src/styles/global.css:892-1141, 1365-1577`

**Interfaces:**
- Produces Home film order: hero, process, bento, feature-card, cta-footer.
- Produces exactly one scroll film.

- [ ] **Step 1: Write failing exact placement assertions**

Assert exact film order, exactly one `data-scroll-film`, scroll behaviour only on process, no film in `#contact`, and proof text:

- `1 workflow Selected before a build begins.`
- `3 handover assets Prompts, logs and a runbook stay with the owner.`

Add `1 workflow` to the existing `approvedNarrativeClaims` test allowlist; do not broaden the numeric-claim regular expression or add any other claim exception.

Rename `obsoleteVideoNames` to `rawLegacyVideoNames`. Keep rejecting only the unsuffixed historical files (`process.mp4`, `bento.mp4`, `feature-card.mp4`, `cta-footer.mp4`, and `hero.mp4`); the generated responsive filenames are now required.

Run: `npx vitest run src/pages-content.output.test.js`

Expected: FAIL.

- [ ] **Step 2: Add process and proof clarity**

Import `MotionFilm`. Replace each bare number with `.proof-value` number/unit markup and exact supporting text. Between loop heading and sequence add:

```astro
<div class="loop-section__film-region" data-scroll-film-region>
  <MotionFilm
    film="process"
    behaviour="scroll"
    class="loop-section__film"
  />
</div>
```

- [ ] **Step 3: Add bento, ownership and CTA films**

- Wrap pattern heading in `.pattern-aside > .pattern-aside__inner`; add `<MotionFilm film="bento" class="pattern-section__film" />`.
- Wrap principles contents in `.principles-section__body`; place `<MotionFilm film="feature-card" class="principles-section__film" />` beside unchanged rows.
- Before final CTA container add `<MotionFilm film="cta-footer" class="home-final-cta__film" />` and `.home-final-cta__scrim`.

Keep packages, prices, links and principles unchanged.

- [ ] **Step 4: Add homepage composition CSS**

Use a sticky desktop process film inside a taller region; sticky pattern aside only above 860px; a two-column principles body; and isolated CTA film/scrim behind copy with pointer events disabled. Reserve 16:9 and 3:4 ratios before loading.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/pages-content.output.test.js src/scripts/media.test.js src/scripts/scroll-film.test.js`

Expected: PASS.

```bash
git add src/pages/index.astro src/pages-content.output.test.js src/styles/global.css
git commit -m "feat: restore homepage cinematic chapters"
```

### Task 7: Restore Services and compact its middle chapters

**Files:**
- Modify: `src/pages/services.astro:40-214`
- Modify: `src/pages-content.output.test.js:437-693, 747-850`
- Modify: `src/styles/global.css:708-735, 1209-1577`

**Interfaces:**
- Produces Services film order: process, feature-card; neither scrolls.
- Preserves `#contact` markup and contact script byte-for-byte.

- [ ] **Step 1: Write failing placement/isolation assertions**

Assert exact film order, no scroll attribute, no video in contact, compact modifier on Method/Packages/Fit/Handover, and no compact modifier on Contact.

Run: `npx vitest run src/pages-content.output.test.js`

Expected: FAIL.

- [ ] **Step 2: Integrate films without touching the form**

- Add `editorial-section--compact` to Method, Packages, Good-fit and Handover.
- Create `.services-method__body` with existing rows and `<MotionFilm film="process" class="services-method__film" />`.
- Create `.handover-section__copy` around existing heading/paragraphs and add `<MotionFilm film="feature-card" class="handover-section__film" />`.
- Do not edit from `<section id="contact"` through the contact script.

- [ ] **Step 3: Add exact spacing tokens**

```css
:root {
  --editorial-section-space: clamp(5rem, 9vw, 8rem);
  --editorial-section-space-compact: clamp(4.25rem, 7.65vw, 6.8rem);
}

.editorial-section {
  padding-top: var(--editorial-section-space);
  padding-bottom: var(--editorial-section-space);
}

.editorial-section--compact {
  padding-top: var(--editorial-section-space-compact);
  padding-bottom: var(--editorial-section-space-compact);
}
```

Use two-column method/handover grids above 860px and stack film before copy below it.

- [ ] **Step 4: Run all contact regressions**

Run: `npx vitest run src/pages-content.output.test.js src/scripts/contact-form.test.js src/scripts/turnstile.test.js src/services-lifecycle.test.js contact-worker/src/index.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/services.astro src/pages-content.output.test.js src/styles/global.css
git commit -m "feat: restore services cinematic support"
```

### Task 8: Restore restrained About and Field Notes motion

**Files:**
- Modify: `src/pages/about.astro:10-30`
- Modify: `src/pages/blog.astro:19-31`
- Modify: `src/pages-content.output.test.js:747-1048`
- Modify: `src/styles/global.css:1595-1775, 1993-2090`

**Interfaces:**
- Produces About film: feature-card.
- Produces Field Notes film: cta-footer.
- Keeps articles and 404 at zero films.

- [ ] **Step 1: Write failing supporting-page assertions**

Assert exact film identity, no scroll attributes on About/Blog, no article/404 video, and all existing note row/title/date/link contracts.

Run: `npx vitest run src/pages-content.output.test.js`

Expected: FAIL.

- [ ] **Step 2: Add About film and factual caption**

Replace the standalone identity aside with:

```astro
<div class="about-hero__visual">
  <MotionFilm film="feature-card" class="about-hero__film">
    <Fragment slot="caption">
      <aside
        class="about-identity"
        aria-label="Oliver Hitchings working focus"
        data-about-identity
      >
        <p data-field="Name">Oliver Hitchings</p>
        <p data-field="Focus">Automation systems</p>
        <p data-field="Sequence">Map → Build → Hand over</p>
      </aside>
    </Fragment>
  </MotionFilm>
</div>
```

Keep every other About section unchanged.

- [ ] **Step 3: Add one Field Notes film**

Make `.blog-hero__grid` the outer container, retain `.blog-hero__copy`, and add:

```astro
<MotionFilm film="cta-footer" class="blog-hero__film" />
```

Do not add media to note rows or articles.

- [ ] **Step 4: Style and verify**

Use a 3:4 About crop with factual caption on a solid surface; use contained 16:9 Field Notes media. Stack after copy on mobile. Preserve note/article rhythm.

Run: `npx vitest run src/pages-content.output.test.js src/site-frame.output.test.js`

Expected: PASS with video counts Home 5, Services 2, About 1, Blog 1, article 0, 404 0.

- [ ] **Step 5: Commit**

```bash
git add src/pages/about.astro src/pages/blog.astro src/pages-content.output.test.js src/styles/global.css
git commit -m "feat: restore restrained supporting-page motion"
```

### Task 9: Finish responsive structural polish

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/pages-content.output.test.js`
- Modify: `src/site-frame.output.test.js`

**Interfaces:**
- Produces compact mobile clearance, five-line pattern heading, stable crops and shared spacing.

- [ ] **Step 1: Add failing stylesheet assertions**

Assert generated CSS contains:

- `--mobile-page-start:9.5rem`;
- compact section token/modifier;
- reduced-motion rules for menu controls;
- `text-wrap:balance` for pattern heading;
- 16/9 and 3/4 motion-film aspect ratios.

Run: `npx vitest run src/pages-content.output.test.js src/site-frame.output.test.js`

Expected: FAIL until all rules exist.

- [ ] **Step 2: Implement exact final responsive rules**

Add `--mobile-page-start: 9.5rem`. At 620px and below use it for Home, Services, About, Field Notes, article and 404 first-section clearance. Give `.pattern-heading h2` balanced wrapping, 12ch mobile measure, and a section-only clamp that renders at five lines or fewer at 390px. Stack films before copy on mobile, keep all pointer events off decorative layers, and prevent horizontal overflow.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run src/pages-content.output.test.js src/site-frame.output.test.js`

Expected: PASS.

```bash
git add src/styles/global.css src/pages-content.output.test.js src/site-frame.output.test.js
git commit -m "style: refine cinematic editorial rhythm"
```

### Task 10: Complete regression and local rendered QA

**Files:**
- Verify only; do not create deployment files or production configuration.

**Interfaces:**
- Consumes complete Objective 1 branch.
- Produces a running local preview and visual evidence.

- [ ] **Step 1: Run complete automated gates**

```bash
npm test
npm run check:media
npm run build
node scripts/verify-contact-release-config.mjs
git diff --check
git status --short --branch
git diff --exit-code origin/main -- contact-worker shared/contact-config.js src/scripts/contact-form.js src/scripts/contact-form.test.js src/scripts/turnstile.js src/scripts/turnstile.test.js contact-worker/wrangler.toml .github/workflows/deploy.yml
```

Expected: all tests/media checks pass, Astro build and release-config verification succeed, no whitespace errors, a clean local branch, and no diff at all in the protected contact/deployment paths.

- [ ] **Step 2: Start local preview**

Confirm port 4321 is free with `lsof -nP -iTCP:4321 -sTCP:LISTEN`. Run:

```bash
npm run preview -- --port 4321
```

Expected: local URL `http://localhost:4321/`. Keep it running.

- [ ] **Step 3: Inspect required routes and viewports**

Use the in-app browser on localhost only. Inspect Home, Services, About, Field Notes, one article and a missing route at 390x844, 768x1024, 1024x768 and 1440x900. Capture evidence and check horizontal overflow, hidden text, clipped controls, console errors and failed media requests.

- [ ] **Step 4: Verify behaviour/fallbacks/contact isolation**

- Desktop Home: process `currentTime` changes through its region while video remains paused.
- Mobile Home: process loops instead of scrubbing.
- Ambient films load nearby, pause off-screen and resume.
- Reduced motion and Save-Data keep posters and do not promote sources.
- At 390px the closed header is one row; second click, outside pointer and Escape close the menu; Escape returns focus; pattern heading is no more than five lines.
- Services form fields, select, Turnstile container, submit control and status region remain usable without form submission.
- `#contact` contains no film and film layers cannot intercept pointer/keyboard input.

- [ ] **Step 5: Leave Objective 1 open for Oliver**

Keep `http://localhost:4321/` open as the deliverable tab. Report exact test results, URL, branch, commits and media transfers, and confirm production was untouched.

Do not push, merge, deploy or begin Objective 2 until Oliver has inspected Objective 1.
