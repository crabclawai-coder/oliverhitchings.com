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
    panel.setAttribute("inert", "");
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
    panel.toggleAttribute("inert", !opening);
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
    ) {
      return;
    }
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
