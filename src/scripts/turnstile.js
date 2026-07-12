const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DEFAULT_LOAD_TIMEOUT_MS = 8_000;
const VALID_MODES = new Set(["off", "observe", "required"]);
const loadPromises = new WeakMap();

const STATE_MESSAGES = {
  loading: "Security check is loading. Wait a moment, then try again.",
  missing: "Complete the security check, then send your enquiry.",
  expired:
    "The security check expired. Complete it again, then send your enquiry.",
  timeout:
    "The security check timed out. Complete it again, then send your enquiry.",
  error:
    "The security check could not load. Refresh the page or email Oliver directly.",
  unsupported:
    "This browser cannot run the security check. Try another browser or email Oliver directly.",
  unavailable:
    "The security check is unavailable because the site is not configured. Email Oliver directly.",
  "configuration-error":
    "The enquiry form security mode is not configured correctly. Email Oliver directly.",
};

const OBSERVE_STATE_MESSAGES = {
  loading: "Security check is loading. You can still send your enquiry.",
  missing: "Security check is not complete. You can still send your enquiry.",
  expired: "The security check expired. You can still send your enquiry.",
  timeout: "The security check timed out. You can still send your enquiry.",
  error: "The security check could not load. You can still send your enquiry.",
  unsupported:
    "This browser cannot run the security check. You can still send your enquiry.",
  unavailable:
    "The security check is not configured. You can still send your enquiry.",
};

function normaliseMode(mode) {
  const value = String(mode ?? "").trim().toLowerCase();
  return value || "off";
}

export function loadTurnstileApi({
  mode = "off",
  documentRef = globalThis.document,
  windowRef = globalThis,
  timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (normaliseMode(mode) === "off") {
    return Promise.resolve(null);
  }

  if (typeof windowRef?.turnstile?.render === "function") {
    return Promise.resolve(windowRef.turnstile);
  }

  if (!documentRef?.createElement || !documentRef?.head) {
    return Promise.reject(new Error("Turnstile cannot load without a document."));
  }

  const pendingLoad = loadPromises.get(documentRef);
  if (pendingLoad) {
    return pendingLoad;
  }

  const script = documentRef.createElement("script");
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  script.defer = true;

  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;

    const cleanup = () => {
      clearTimeoutImpl(timeoutId);
      script.onload = null;
      script.onerror = null;
    };

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      script.remove();
      loadPromises.delete(documentRef);
      reject(error);
    };

    script.onload = () => {
      if (settled) {
        return;
      }

      if (typeof windowRef?.turnstile?.render !== "function") {
        fail(new Error("Turnstile loaded without a supported browser API."));
        return;
      }

      settled = true;
      cleanup();
      resolve(windowRef.turnstile);
    };
    script.onerror = () => {
      fail(new Error("Turnstile failed to load."));
    };

    timeoutId = setTimeoutImpl(() => {
      fail(new Error(`Turnstile load timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    documentRef.head.append(script);
  });

  loadPromises.set(documentRef, promise);
  return promise;
}

export function createTurnstileAdapter({
  mode: configuredMode = "off",
  siteKey = "",
  container = null,
  announce = () => {},
  loadApi = loadTurnstileApi,
  documentRef = globalThis.document,
  windowRef = globalThis,
  loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
} = {}) {
  const mode = normaliseMode(configuredMode);
  const validMode = VALID_MODES.has(mode);
  const required = mode === "required" || !validMode;
  let api = null;
  let destroyed = false;
  let state = mode === "off" ? "off" : "loading";
  let token = "";
  let widgetId = null;
  let suppressStatusAnnouncements = false;

  const announceUnlessSuppressed = (message) => {
    if (!suppressStatusAnnouncements) {
      announce(message);
    }
  };

  const messageForState = (nextState) =>
    (mode === "observe" && OBSERVE_STATE_MESSAGES[nextState]) ||
    STATE_MESSAGES[nextState];

  const setState = (nextState, { message = true } = {}) => {
    state = nextState;
    const stateMessage = messageForState(nextState);
    if (message && stateMessage) {
      announceUnlessSuppressed(stateMessage);
    }
  };

  const widgetOptions = {
    sitekey: String(siteKey).trim(),
    action: "contact",
    theme: "dark",
    size: "flexible",
    "response-field": false,
    callback(responseToken) {
      if (destroyed) {
        return;
      }

      token = String(responseToken ?? "").trim();
      if (!token) {
        setState("missing");
        return;
      }

      state = "ready";
      announceUnlessSuppressed(
        "Security check complete. You can send your enquiry.",
      );
    },
    "error-callback"() {
      if (!destroyed) {
        token = "";
        setState("error");
      }
    },
    "expired-callback"() {
      if (!destroyed) {
        token = "";
        setState("expired");
      }
    },
    "timeout-callback"() {
      if (!destroyed) {
        token = "";
        setState("timeout");
      }
    },
    "unsupported-callback"() {
      if (!destroyed) {
        token = "";
        setState("unsupported");
      }
    },
  };

  const initialise = async () => {
    if (mode === "off") {
      return;
    }

    if (!validMode) {
      setState("configuration-error");
      return;
    }

    if (!String(siteKey).trim() || !container) {
      setState("unavailable");
      return;
    }

    setState("loading");

    try {
      const loadedApi = await loadApi({
        mode,
        documentRef,
        windowRef,
        timeoutMs: loadTimeoutMs,
      });

      if (destroyed) {
        return;
      }

      if (typeof loadedApi?.render !== "function") {
        setState("unsupported");
        return;
      }

      api = loadedApi;
      widgetId = api.render(container, widgetOptions);
      if (state === "loading") {
        setState("missing");
      }
    } catch {
      if (!destroyed) {
        setState("error");
      }
    }
  };

  const getSubmissionDecision = () => {
    const allowed = mode === "off" || mode === "observe" || Boolean(token);
    const stateMessage = messageForState(state);
    if (required && !allowed && stateMessage) {
      suppressStatusAnnouncements = false;
      announce(stateMessage);
    }

    return { allowed, state, token: token || "" };
  };

  const ready = initialise();

  return {
    mode,
    required,
    ready,
    getToken() {
      return token;
    },
    getSubmissionDecision,
    prepareSubmission() {
      return getSubmissionDecision();
    },
    reset() {
      if (destroyed) {
        return;
      }

      suppressStatusAnnouncements = true;
      token = "";
      if (mode !== "off") {
        setState(widgetId === null ? state : "missing", { message: false });
      }
      if (api && widgetId !== null && typeof api.reset === "function") {
        try {
          api.reset(widgetId);
        } catch {
          // The consumed token stays cleared even if the provider cannot reset.
        }
      }
    },
    focus() {
      if (destroyed || !container) {
        return;
      }

      const iframe = container.querySelector?.("iframe");
      try {
        if (typeof iframe?.focus === "function") {
          iframe.focus();
          return;
        }
      } catch {
        // Fall through to the stable wrapper when the provider frame cannot focus.
      }

      container.focus?.();
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      token = "";
      if (api && widgetId !== null && typeof api.remove === "function") {
        api.remove(widgetId);
      }
      widgetId = null;
    },
  };
}
