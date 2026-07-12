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

    if (response.ok) {
      throw new TypeError("The successful response body could not be read.");
    }

    return null;
  }
}

function isDeliveryUnknownError(error) {
  return error instanceof TypeError || error?.name === "AbortError";
}

function createSubmissionId() {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }

  if (typeof cryptoRef?.getRandomValues === "function") {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  throw new Error("This browser cannot create an enquiry identity.");
}

const normaliseSingleLine = (value) =>
  String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();

const normaliseMultiline = (value) =>
  String(value ?? "").replace(/\r/g, "");

const createSubmissionSignature = (requestBody) =>
  JSON.stringify({
    name: normaliseSingleLine(requestBody.name),
    email: normaliseSingleLine(requestBody.email),
    contact_number: normaliseSingleLine(requestBody.contact_number),
    package_interest: normaliseSingleLine(requestBody.package_interest),
    automation_request: normaliseMultiline(requestBody.automation_request),
    tools_involved: normaliseMultiline(requestBody.tools_involved),
  });

export function createContactFormController({
  form,
  status,
  fetchImpl = defaultFetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  turnstile = null,
}) {
  const submitButton = form.querySelector("button[type='submit']");
  let inFlight = false;
  let submissionId = "";
  let submissionSignature = "";

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
    let abortController;
    let timeoutId;
    let serverAttempted = false;

    form.setAttribute("aria-busy", "true");

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const decision = turnstile?.prepareSubmission
        ? await turnstile.prepareSubmission()
        : { allowed: true, token: turnstile?.getToken?.() ?? "" };

      if (decision?.allowed === false) {
        turnstile?.focus?.();
        return;
      }

      const token = String(decision?.token ?? "").trim();
      const requestBody = Object.fromEntries(formData.entries());
      const nextSubmissionSignature = createSubmissionSignature(requestBody);
      if (
        !submissionId ||
        nextSubmissionSignature !== submissionSignature
      ) {
        submissionId = createSubmissionId();
        submissionSignature = nextSubmissionSignature;
      }
      requestBody.submission_id = submissionId;
      if (token) {
        requestBody.turnstile_token = token;
      }

      abortController = new AbortController();
      timeoutId = globalThis.setTimeout(
        () => abortController.abort(),
        timeoutMs,
      );
      serverAttempted = true;
      setStatus(MESSAGES.pending);

      if (submitButton) {
        submitButton.textContent = "Sending…";
      }

      const response = await fetchImpl(form.action, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
      const payload = await readJson(response);

      if (response.ok && payload?.ok === true) {
        submissionId = "";
        submissionSignature = "";
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
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      try {
        if (serverAttempted) {
          turnstile?.reset?.();
        }
      } catch {
        // Preserve the completed delivery outcome when an adapter cannot reset.
      } finally {
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
    }
  };

  form.addEventListener("submit", handleSubmit);

  return {
    destroy() {
      form.removeEventListener("submit", handleSubmit);
      turnstile?.destroy?.();
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
