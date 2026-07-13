export function initializePageLifecycle({
  window: windowRef = globalThis.window,
  controllers = [],
} = {}) {
  let destroyed = false;

  const destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    windowRef?.removeEventListener("pagehide", handlePageHide);
    controllers.forEach((controller) => controller?.destroy?.());
  };

  const handlePageHide = (event) => {
    if (event.persisted) {
      return;
    }

    destroy();
  };

  windowRef?.addEventListener("pagehide", handlePageHide);

  return { destroy };
}
