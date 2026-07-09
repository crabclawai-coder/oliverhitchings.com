// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import * as contactFormModule from "./contact-form.js";

const INITIAL_STATUS =
  "This sends the enquiry directly from the website to oliver@example.com.";
const SUCCESS_STATUS = "Your enquiry was sent successfully.";
const ERROR_STATUS =
  "We could not send your enquiry. Please try again or email Oliver directly.";
const DELIVERY_UNKNOWN_STATUS =
  "We could not confirm delivery. Your enquiry may have been sent; keep this page open and check before retrying.";

function renderForm() {
  document.body.innerHTML = `
    <form action="/api/contact" method="POST" data-contact-form>
      <input name="_honey" value="" />
      <input name="name" required />
      <input name="email" type="email" required />
      <select name="package_interest" required>
        <option value="">Choose one</option>
        <option value="Task Map">Task Map</option>
      </select>
      <textarea name="automation_request" required></textarea>
      <textarea name="tools_involved"></textarea>
      <button type="submit">Send enquiry</button>
      <p data-contact-status>${INITIAL_STATUS}</p>
    </form>
  `;

  const form = document.querySelector("[data-contact-form]");
  const status = form.querySelector("[data-contact-status]");
  const button = form.querySelector("button[type='submit']");

  form.elements.namedItem("name").value = "Roger";
  form.elements.namedItem("email").value = "roger@example.com";
  form.elements.namedItem("package_interest").value = "Task Map";
  form.elements.namedItem("automation_request").value = "Automate the weekly report";
  form.elements.namedItem("tools_involved").value = "Sheets";

  return { form, status, button };
}

function setupController({ fetchImpl = vi.fn(), timeoutMs, turnstile } = {}) {
  const elements = renderForm();
  const controller = contactFormModule.createContactFormController({
    form: elements.form,
    status: elements.status,
    fetchImpl,
    timeoutMs,
    turnstile,
  });

  return { ...elements, controller, fetchImpl };
}

function turnstileAdapter({
  allowed = true,
  token = "",
  state = token ? "ready" : "missing",
  preparation,
} = {}) {
  return {
    prepareSubmission: vi
      .fn()
      .mockImplementation(() =>
        preparation ? preparation.promise : { allowed, state, token },
      ),
    reset: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
  };
}

function dispatchSubmit(form) {
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

function jsonResponse(status, body, jsonError) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jsonError
      ? vi.fn().mockRejectedValue(jsonError)
      : vi.fn().mockResolvedValue(body),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createContactFormController", () => {
  it("leaves the explanatory status intact during initialization", () => {
    const { status } = setupController();

    expect(status.textContent).toBe(INITIAL_STATUS);
  });

  it("keeps the submit button pending until the request settles", async () => {
    const request = deferred();
    const { form, status, button } = setupController({
      fetchImpl: vi.fn().mockReturnValue(request.promise),
    });

    dispatchSubmit(form);

    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Sending…");
    expect(status.textContent).toBe("Sending enquiry…");

    request.resolve(jsonResponse(200, { ok: true }));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it("does not reset entered values before the server responds", async () => {
    const request = deferred();
    const { form } = setupController({
      fetchImpl: vi.fn().mockReturnValue(request.promise),
    });

    dispatchSubmit(form);

    expect(form.elements.namedItem("name").value).toBe("Roger");
    expect(form.elements.namedItem("automation_request").value).toBe(
      "Automate the weekly report",
    );

    request.resolve(jsonResponse(200, { ok: true }));
    await vi.waitFor(() =>
      expect(form.elements.namedItem("name").value).toBe(""),
    );
  });

  it("resets the form only after a confirmed successful response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const { form, status } = setupController({ fetchImpl });

    dispatchSubmit(form);

    await vi.waitFor(() => expect(status.textContent).toBe(SUCCESS_STATUS));
    expect(status.classList.contains("is-success")).toBe(true);
    expect(form.elements.namedItem("name").value).toBe("");
    expect(form.elements.namedItem("package_interest").value).toBe("");
  });

  it.each([400, 413, 429, 502, 503])(
    "preserves values and displays the server message for HTTP %i",
    async (responseStatus) => {
      const serverMessage = `Server message for ${responseStatus}`;
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(responseStatus, { message: serverMessage }));
      const { form, status } = setupController({ fetchImpl });

      dispatchSubmit(form);

      await vi.waitFor(() => expect(status.textContent).toBe(serverMessage));
      expect(form.elements.namedItem("name").value).toBe("Roger");
      expect(form.elements.namedItem("automation_request").value).toBe(
        "Automate the weekly report",
      );
    },
  );

  it("uses a stable fallback for a non-JSON error response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(502, undefined, new SyntaxError("Unexpected token")),
      );
    const { form, status } = setupController({ fetchImpl });

    dispatchSubmit(form);

    await vi.waitFor(() => expect(status.textContent).toBe(ERROR_STATUS));
    expect(form.elements.namedItem("name").value).toBe("Roger");
  });

  it("reports delivery unknown when the response body is lost", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, undefined, new TypeError("Network connection lost")),
      );
    const { form, status } = setupController({ fetchImpl });

    dispatchSubmit(form);

    await vi.waitFor(() =>
      expect(status.textContent).toBe(DELIVERY_UNKNOWN_STATUS),
    );
    expect(form.elements.namedItem("name").value).toBe("Roger");
  });

  it.each([
    ["network loss", new TypeError("Failed to fetch")],
    ["request timeout", new DOMException("Timed out", "AbortError")],
  ])(
    "preserves values and reports delivery unknown after %s",
    async (_label, error) => {
      const fetchImpl = vi.fn().mockRejectedValue(error);
      const { form, status } = setupController({ fetchImpl });

      dispatchSubmit(form);

      await vi.waitFor(() =>
        expect(status.textContent).toBe(DELIVERY_UNKNOWN_STATUS),
      );
      expect(form.elements.namedItem("name").value).toBe("Roger");
      expect(form.elements.namedItem("automation_request").value).toBe(
        "Automate the weekly report",
      );
    },
  );

  it("does not start a second request while one is pending", async () => {
    const request = deferred();
    const fetchImpl = vi.fn().mockReturnValue(request.promise);
    const { form } = setupController({ fetchImpl });

    dispatchSubmit(form);
    dispatchSubmit(form);

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    request.resolve(jsonResponse(200, { ok: true }));
    await vi.waitFor(() =>
      expect(form.elements.namedItem("name").value).toBe(""),
    );
  });

  it("restores the button and aria-busy state after a request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { message: "Try again later." }));
    const { form, status, button } = setupController({ fetchImpl });

    dispatchSubmit(form);

    expect(form.getAttribute("aria-busy")).toBe("true");

    await vi.waitFor(() => expect(status.textContent).toBe("Try again later."));
    expect(form.hasAttribute("aria-busy")).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Send enquiry");
  });

  it("silently ignores a completed honeypot", () => {
    const { form, status, button, fetchImpl } = setupController();
    form.elements.namedItem("_honey").value = "bot";

    const event = dispatchSubmit(form);

    expect(event.defaultPrevented).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(status.textContent).toBe(INITIAL_STATUS);
    expect(button.disabled).toBe(false);
  });

  it("preserves native validity checks before sending", () => {
    const { form, status, fetchImpl } = setupController();
    form.elements.namedItem("email").value = "";
    const reportValidity = vi.spyOn(form, "reportValidity");

    dispatchSubmit(form);

    expect(reportValidity).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(status.textContent).toBe(INITIAL_STATUS);
  });

  it("renders a provider message as text rather than HTML", async () => {
    const providerMessage = '<img src=x onerror="alert(1)">Try by email.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, { message: providerMessage }));
    const { form, status } = setupController({ fetchImpl });

    dispatchSubmit(form);

    await vi.waitFor(() => expect(status.textContent).toBe(providerMessage));
    expect(status.children).toHaveLength(0);
  });

  it("posts the current fields as same-origin JSON", async () => {
    const request = deferred();
    const fetchImpl = vi.fn().mockReturnValue(request.promise);
    const { form } = setupController({ fetchImpl });

    dispatchSubmit(form);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(form.action);
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(options.body)).toEqual({
      _honey: "",
      name: "Roger",
      email: "roger@example.com",
      package_interest: "Task Map",
      automation_request: "Automate the weekly report",
      tools_involved: "Sheets",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);

    request.resolve(jsonResponse(200, { ok: true }));
    await vi.waitFor(() =>
      expect(form.elements.namedItem("name").value).toBe(""),
    );
  });

  it("aborts after the default 12 second timeout", async () => {
    vi.useFakeTimers();
    let requestSignal;
    const fetchImpl = vi.fn().mockImplementation((_url, options) => {
      requestSignal = options.signal;

      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        );
      });
    });
    const { form, status, button } = setupController({ fetchImpl });

    dispatchSubmit(form);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(requestSignal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(requestSignal.aborted).toBe(true);
    expect(status.textContent).toBe(DELIVERY_UNKNOWN_STATUS);
    expect(button.disabled).toBe(false);
  });

  it.each(["missing", "loading", "error"])(
    "allows one observe-mode request while the security state is %s",
    async (state) => {
      const turnstile = turnstileAdapter({ allowed: true, state });
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(503, { message: "Try again later." }));
      const { form, status } = setupController({ fetchImpl, turnstile });

      dispatchSubmit(form);

      await vi.waitFor(() => expect(status.textContent).toBe("Try again later."));
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty(
        "turnstile_token",
      );
      expect(turnstile.reset).toHaveBeenCalledOnce();
    },
  );

  it("adds exactly one non-empty Turnstile token to the JSON payload", async () => {
    const turnstile = turnstileAdapter({ token: "verified-token" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const { form, status } = setupController({ fetchImpl, turnstile });

    dispatchSubmit(form);

    await vi.waitFor(() => expect(status.textContent).toBe(SUCCESS_STATUS));
    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(payload.turnstile_token).toBe("verified-token");
    expect(
      Object.keys(payload).filter((key) => key === "turnstile_token"),
    ).toHaveLength(1);
  });

  it.each(["loading", "missing", "error", "unsupported"])(
    "blocks required mode in %s state without fetch, reset, or form loss",
    async (state) => {
      const turnstile = turnstileAdapter({ allowed: false, state });
      const { form, fetchImpl } = setupController({ turnstile });

      dispatchSubmit(form);

      await vi.waitFor(() =>
        expect(turnstile.prepareSubmission).toHaveBeenCalledOnce(),
      );
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(turnstile.reset).not.toHaveBeenCalled();
      expect(turnstile.focus).toHaveBeenCalledOnce();
      expect(form.elements.namedItem("name").value).toBe("Roger");
      expect(form.elements.namedItem("automation_request").value).toBe(
        "Automate the weekly report",
      );
    },
  );

  it("guards duplicate submits while security preparation is pending", async () => {
    const preparation = deferred();
    const turnstile = turnstileAdapter({ preparation });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const { form, status } = setupController({ fetchImpl, turnstile });

    dispatchSubmit(form);
    dispatchSubmit(form);

    expect(turnstile.prepareSubmission).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();

    preparation.resolve({ allowed: true, state: "ready", token: "token-1" });
    await vi.waitFor(() => expect(status.textContent).toBe(SUCCESS_STATUS));

    expect(turnstile.prepareSubmission).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["confirmed success", () => Promise.resolve(jsonResponse(200, { ok: true }))],
    ["other 2xx", () => Promise.resolve(jsonResponse(202, { ok: false }))],
    ["client error", () => Promise.resolve(jsonResponse(400, { message: "Bad request" }))],
    ["server error", () => Promise.resolve(jsonResponse(503, { message: "Unavailable" }))],
    ["network loss", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "request abort",
      () => Promise.reject(new DOMException("Timed out", "AbortError")),
    ],
  ])("resets the widget exactly once after %s", async (_label, response) => {
    const turnstile = turnstileAdapter({ token: "one-use-token" });
    const fetchImpl = vi.fn().mockImplementation(response);
    const { form, button } = setupController({ fetchImpl, turnstile });

    dispatchSubmit(form);

    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(turnstile.reset).toHaveBeenCalledOnce();
  });

  it("starts the request timeout only after security allows the attempt", async () => {
    vi.useFakeTimers();
    const preparation = deferred();
    const turnstile = turnstileAdapter({ preparation });
    let requestSignal;
    const fetchImpl = vi.fn().mockImplementation((_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener(
          "abort",
          () => reject(new DOMException("Timed out", "AbortError")),
          { once: true },
        );
      });
    });
    const { form, status } = setupController({ fetchImpl, turnstile });

    dispatchSubmit(form);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetchImpl).not.toHaveBeenCalled();

    preparation.resolve({ allowed: true, state: "ready", token: "token-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestSignal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(requestSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSignal.aborted).toBe(true);
    expect(status.textContent).toBe(DELIVERY_UNKNOWN_STATUS);
    expect(turnstile.reset).toHaveBeenCalledOnce();
  });

  it("destroys both the controller listener and adapter", async () => {
    const turnstile = turnstileAdapter();
    const { form, controller, fetchImpl } = setupController({ turnstile });

    controller.destroy();
    dispatchSubmit(form);
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(turnstile.destroy).toHaveBeenCalledOnce();
  });
});

describe("initContactForms", () => {
  it("initializes marked forms without replacing their explanatory status", () => {
    const { status } = renderForm();

    const controllers = contactFormModule.initContactForms({
      fetchImpl: vi.fn(),
    });

    expect(controllers).toHaveLength(1);
    expect(status.textContent).toBe(INITIAL_STATUS);
  });
});
