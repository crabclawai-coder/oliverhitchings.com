// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initContactForms } from "./scripts/contact-form.js";

const INITIAL_STATUS = "Initial contact guidance.";
const SUCCESS_STATUS = "Your enquiry was sent successfully.";
const OBSERVE_LOADING_STATUS =
  "Security check is loading. You can still send your enquiry.";
const REQUIRED_LOADING_STATUS =
  "Security check is loading. Wait a moment, then try again.";
const REQUIRED_ERROR_STATUS =
  "The security check could not load. Refresh the page or email Oliver directly.";

const servicesSource = await readFile(
  join(process.cwd(), "src/pages/services.astro"),
  "utf8",
);
const servicesInitializerSource = servicesSource.match(
  /<script>\s*([\s\S]*?)\s*<\/script>\s*<\/BaseLayout>/,
)?.[1];

if (!servicesInitializerSource) {
  throw new Error("Could not find the services page initializer.");
}

const executableInitializerSource = servicesInitializerSource
  .replace(
    /^\s*import \{ initContactForms \} from "\.\.\/scripts\/contact-form\.js";\s*/m,
    "",
  )
  .replaceAll("import.meta.env.", "environment.")
  .replace(
    'import("../scripts/turnstile.js")',
    "loadTurnstileModule()",
  );
const executeServicesInitializer = new Function(
  "document",
  "environment",
  "initContactForms",
  "loadTurnstileModule",
  executableInitializerSource,
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function renderForm() {
  document.body.innerHTML = `
    <form action="/api/contact" method="POST" data-contact-form data-turnstile-site-key="test-site-key">
      <input name="_honey" value="" />
      <input name="name" required value="Test user" />
      <input name="email" type="email" required value="test@example.com" />
      <select name="package_interest" required>
        <option value="Task Map" selected>Task Map</option>
      </select>
      <textarea name="automation_request" required>Automate a report</textarea>
      <button type="submit">Send enquiry</button>
      <div data-turnstile-container tabindex="-1"></div>
      <p data-contact-status>${INITIAL_STATUS}</p>
    </form>
  `;

  const form = document.querySelector("[data-contact-form]");
  return {
    button: form.querySelector("button[type='submit']"),
    form,
    status: form.querySelector("[data-contact-status]"),
  };
}

function startServicesInitializer({ mode, fetchImpl = vi.fn() }) {
  const elements = renderForm();
  const turnstileModule = deferred();
  let turnstile;

  const initialiseContactForms = vi.fn(({ turnstile: proxy }) => {
    turnstile = proxy;
    return initContactForms({ fetchImpl, turnstile: proxy });
  });
  const loadTurnstileModule = vi.fn(() => turnstileModule.promise);

  executeServicesInitializer(
    document,
    { PUBLIC_TURNSTILE_MODE: mode },
    initialiseContactForms,
    loadTurnstileModule,
  );

  return {
    ...elements,
    get turnstile() {
      return turnstile;
    },
    turnstileModule,
  };
}

function dispatchSubmit(form) {
  form.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
}

function adapterContract(overrides = {}) {
  return {
    destroy: vi.fn(),
    focus: vi.fn(),
    prepareSubmission: vi
      .fn()
      .mockReturnValue({ allowed: true, state: "ready", token: "" }),
    required: false,
    reset: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("services Turnstile lifecycle", () => {
  it("preserves an observe-mode delivery result when the adapter initialises later", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
    });
    const harness = startServicesInitializer({ fetchImpl, mode: "observe" });
    const reset = vi.spyOn(harness.turnstile, "reset");

    dispatchSubmit(harness.form);

    await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce());
    expect(harness.button.disabled).toBe(false);
    expect(harness.status.textContent).toBe(SUCCESS_STATUS);

    const createTurnstileAdapter = vi.fn(({ announce }) => {
      announce(OBSERVE_LOADING_STATUS);
      return adapterContract();
    });
    harness.turnstileModule.resolve({ createTurnstileAdapter });
    await vi.waitFor(() =>
      expect(createTurnstileAdapter).toHaveBeenCalledOnce(),
    );

    expect(harness.status.textContent).toBe(SUCCESS_STATUS);
    expect(harness.status.classList.contains("is-success")).toBe(true);
  });

  it("announces required-mode guidance when the user retries after late initialisation", async () => {
    const harness = startServicesInitializer({ mode: "required" });
    harness.turnstile.reset();
    const createTurnstileAdapter = vi.fn(({ announce }) => {
      announce(REQUIRED_ERROR_STATUS);
      return adapterContract({
        prepareSubmission: vi.fn(() => {
          announce(REQUIRED_ERROR_STATUS);
          return { allowed: false, state: "error", token: "" };
        }),
        required: true,
      });
    });

    harness.turnstileModule.resolve({ createTurnstileAdapter });
    await vi.waitFor(() =>
      expect(createTurnstileAdapter).toHaveBeenCalledOnce(),
    );
    expect(harness.status.textContent).toBe(REQUIRED_LOADING_STATUS);

    expect(harness.turnstile.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
    expect(harness.status.textContent).toBe(REQUIRED_ERROR_STATUS);
  });
});
