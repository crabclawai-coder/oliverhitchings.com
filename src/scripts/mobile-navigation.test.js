// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeMobileNavigation } from "./mobile-navigation.js";

const MOBILE_QUERY = "(max-width: 620px)";

function renderNavigation({ complete = true } = {}) {
  document.body.innerHTML = `
    <nav data-mobile-navigation>
      <a href="/">Home</a>
      <div data-mobile-navigation-actions>
        <a href="/services#contact">Start an enquiry</a>
        <button
          type="button"
          aria-expanded="false"
          aria-controls="mobile-primary-navigation"
          data-mobile-menu-toggle
        >Menu</button>
      </div>
      ${
        complete
          ? `<div id="mobile-primary-navigation" data-mobile-menu-panel>
              <a href="/services">Services</a>
            </div>`
          : ""
      }
    </nav>
    <button type="button" data-outside>Outside</button>
  `;

  return {
    actions: document.querySelector("[data-mobile-navigation-actions]"),
    navigation: document.querySelector("[data-mobile-navigation]"),
    outside: document.querySelector("[data-outside]"),
    panel: document.querySelector("[data-mobile-menu-panel]"),
    toggle: document.querySelector("[data-mobile-menu-toggle]"),
  };
}

function createMatchMedia(initialMatches = true) {
  const listeners = new Set();
  const media = {
    matches: initialMatches,
    media: MOBILE_QUERY,
    addEventListener: vi.fn((type, listener) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === "change") listeners.delete(listener);
    }),
  };
  const matchMedia = vi.fn((query) => {
    expect(query).toBe(MOBILE_QUERY);
    return media;
  });

  return {
    matchMedia,
    media,
    setMatches(matches) {
      media.matches = matches;
      for (const listener of listeners) {
        listener({ matches, media: MOBILE_QUERY });
      }
    },
  };
}

function openMenu(toggle) {
  toggle.click();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
}

function selectLink(link) {
  link.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
  link.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("initializeMobileNavigation", () => {
  it("starts ready and closed at the compact breakpoint", () => {
    const { navigation, toggle } = renderNavigation();
    const media = createMatchMedia(true);

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });

    expect(navigation.classList.contains("is-mobile-navigation-ready")).toBe(
      true,
    );
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on the first toggle and closes on the second", () => {
    const { navigation, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });

    toggle.click();
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      true,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    toggle.click();
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the closed panel inert throughout menu transitions", () => {
    const { panel, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });

    expect(panel.hasAttribute("inert")).toBe(true);
    toggle.click();
    expect(panel.hasAttribute("inert")).toBe(false);
    toggle.click();
    expect(panel.hasAttribute("inert")).toBe(true);
  });

  it("closes when a panel link is selected", () => {
    const { navigation, panel, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });
    openMenu(toggle);
    selectLink(panel.querySelector("a"));

    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the compact enquiry action is selected", () => {
    const { actions, navigation, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });
    openMenu(toggle);
    selectLink(actions.querySelector("a"));

    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on an outside pointer without moving focus", () => {
    const { navigation, outside, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });
    openMenu(toggle);
    outside.focus();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
  });

  it("closes on Escape and returns focus to the toggle", () => {
    const { navigation, panel, toggle } = renderNavigation();
    const media = createMatchMedia();

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });
    openMenu(toggle);
    panel.querySelector("a").focus();
    const escape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    document.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("resets the menu across compact-breakpoint transitions", () => {
    const { navigation, toggle } = renderNavigation();
    const media = createMatchMedia(true);

    initializeMobileNavigation({ document, matchMedia: media.matchMedia });
    openMenu(toggle);

    media.setMatches(false);
    expect(navigation.classList.contains("is-mobile-navigation-ready")).toBe(
      false,
    );
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    media.setMatches(true);
    expect(navigation.classList.contains("is-mobile-navigation-ready")).toBe(
      true,
    );
    expect(navigation.classList.contains("is-mobile-navigation-open")).toBe(
      false,
    );
  });

  it("fails safely when markup or matchMedia is incomplete", () => {
    const incomplete = renderNavigation({ complete: false });
    const media = createMatchMedia();

    const incompleteController = initializeMobileNavigation({
      document,
      matchMedia: media.matchMedia,
    });

    expect(media.matchMedia).not.toHaveBeenCalled();
    expect(() => incompleteController.destroy()).not.toThrow();
    expect(incomplete.navigation.className).toBe("");

    const complete = renderNavigation();
    const unsupportedController = initializeMobileNavigation({
      document,
      matchMedia: undefined,
    });

    expect(() => unsupportedController.destroy()).not.toThrow();
    expect(complete.navigation.className).toBe("");
    expect(complete.toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("destroy restores the fallback state and removes listeners", () => {
    const { navigation, outside, toggle } = renderNavigation();
    const media = createMatchMedia();
    const controller = initializeMobileNavigation({
      document,
      matchMedia: media.matchMedia,
    });
    openMenu(toggle);

    controller.destroy();

    expect(navigation.className).toBe("");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(media.media.removeEventListener).toHaveBeenCalledOnce();

    toggle.click();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    media.setMatches(false);
    expect(navigation.className).toBe("");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
