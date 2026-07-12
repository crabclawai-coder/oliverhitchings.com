// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initializePageLifecycle } from "./page-lifecycle.js";

const layoutSource = await readFile(
  join(process.cwd(), "src/layouts/BaseLayout.astro"),
  "utf8",
);
const initializerSource = layoutSource.match(
  /<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/,
)?.[1];

if (!initializerSource) {
  throw new Error("Could not find the base layout initializer.");
}

const executableInitializerSource = initializerSource.replace(
  /^\s*import\s+[^;]+;\s*$/gm,
  "",
);
const executeInitializer = new Function(
  "window",
  "initializeMobileNavigation",
  "initializeScrollFilms",
  "initializeSiteBehaviour",
  "initializeMedia",
  "initializePageLifecycle",
  executableInitializerSource,
);

function pageTransition(type, persisted) {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

function activeController() {
  let active = true;
  let destroyCalls = 0;

  return {
    destroy() {
      destroyCalls += 1;
      active = false;
    },
    get active() {
      return active;
    },
    get destroyCalls() {
      return destroyCalls;
    },
    use() {
      if (!active) {
        throw new Error("Controller has been destroyed.");
      }

      return "active";
    },
  };
}

describe("page lifecycle", () => {
  it("keeps controllers active through BFCache and tears them down once on final pagehide", () => {
    const navigation = activeController();
    const scrollFilms = activeController();
    const media = activeController();

    executeInitializer(
      window,
      () => navigation,
      () => scrollFilms,
      () => {},
      () => media,
      initializePageLifecycle,
    );

    window.dispatchEvent(pageTransition("pagehide", true));

    for (const controller of [navigation, scrollFilms, media]) {
      expect(controller.destroyCalls).toBe(0);
      expect(controller.active).toBe(true);
      expect(controller.use()).toBe("active");
    }

    window.dispatchEvent(pageTransition("pageshow", true));
    window.dispatchEvent(pageTransition("pagehide", false));
    window.dispatchEvent(pageTransition("pagehide", false));

    for (const controller of [navigation, scrollFilms, media]) {
      expect(controller.destroyCalls).toBe(1);
      expect(controller.active).toBe(false);
      expect(() => controller.use()).toThrow("Controller has been destroyed.");
    }
  });

  it("makes explicit lifecycle destruction idempotent", () => {
    const controller = activeController();
    const lifecycle = initializePageLifecycle({
      controllers: [controller],
      window,
    });

    lifecycle.destroy();
    lifecycle.destroy();
    window.dispatchEvent(pageTransition("pagehide", false));

    expect(controller.destroyCalls).toBe(1);
  });
});
