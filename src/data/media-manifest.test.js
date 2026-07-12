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
