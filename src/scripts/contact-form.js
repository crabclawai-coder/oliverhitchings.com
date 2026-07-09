const DEFAULT_TIMEOUT_MS = 12_000;

const MESSAGES = {
  pending: "Sending enquiry…",
  success: "Your enquiry was sent successfully.",
  error:
    "We could not send your enquiry. Please try again or email Oliver directly.",
  deliveryUnknown:
    "We could not confirm delivery. Your enquiry may have been sent; keep this page open and check before retrying.",
};

function defaultFetch(...args) {
  return globalThis.fetch(...args);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    if (isDeliveryUnknownError(error)) {
      throw error;
    }

    return null;
  }
}

function isDeliveryUnknownError(error) {
  return error instanceof TypeError || error?.name === "AbortError";
}

export function createContactFormController({
  form,
  status,
  fetchImpl = defaultFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  turnstile = null,
}) {
  const submitButton = form.querySelector("button[type='submit']");
  let inFlight = false;

  const setStatus = (message, { success = false } = {}) => {
    if (!status) {
      return;
    }

    status.classList.toggle("is-success", success);
    status.textContent = message;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (inFlight) {
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);

    if (String(formData.get("_honey") || "").trim()) {
      return;
    }

    inFlight = true;

    const initialAriaBusy = form.getAttribute("aria-busy");
    const initialButtonDisabled = submitButton?.disabled;
    const initialButtonText = submitButton?.textContent;
    const abortController = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => abortController.abort(),
      timeoutMs,
    );

    form.setAttribute("aria-busy", "true");
    setStatus(MESSAGES.pending);

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending…";
    }

    try {
      const response = await fetchImpl(form.action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(Object.fromEntries(formData.entries())),
        signal: abortController.signal,
      });
      const payload = await readJson(response);

      if (response.ok && payload?.ok === true) {
        form.reset();
        setStatus(MESSAGES.success, { success: true });
        return;
      }

      const serverMessage =
        typeof payload?.message === "string" && payload.message.trim()
          ? payload.message.trim()
          : MESSAGES.error;
      setStatus(serverMessage);
    } catch (error) {
      setStatus(
        isDeliveryUnknownError(error)
          ? MESSAGES.deliveryUnknown
          : MESSAGES.error,
      );
    } finally {
      globalThis.clearTimeout(timeoutId);
      inFlight = false;

      if (initialAriaBusy === null) {
        form.removeAttribute("aria-busy");
      } else {
        form.setAttribute("aria-busy", initialAriaBusy);
      }

      if (submitButton) {
        submitButton.disabled = initialButtonDisabled;
        submitButton.textContent = initialButtonText;
      }
    }
  };

  form.addEventListener("submit", handleSubmit);

  // Release B can supply this adapter without changing the controller API.
  // It is deliberately not required or invoked in the urgent release.
  void turnstile;

  return {
    destroy() {
      form.removeEventListener("submit", handleSubmit);
    },
  };
}

export function initContactForms({
  root = document,
  fetchImpl,
  timeoutMs,
  turnstile,
} = {}) {
  return Array.from(root.querySelectorAll("[data-contact-form]"), (form) =>
    createContactFormController({
      form,
      status: form.querySelector("[data-contact-status]"),
      fetchImpl,
      timeoutMs,
      turnstile,
    }),
  );
}
