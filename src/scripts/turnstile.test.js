// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTurnstileAdapter,
  loadTurnstileApi,
} from "./turnstile.js";

const SITE_KEY = "1x00000000000000000000AA";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function createDocument() {
  return document.implementation.createHTMLDocument("Turnstile test");
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

function createApi() {
  return {
    render: vi.fn().mockReturnValue("widget-1"),
    reset: vi.fn(),
    remove: vi.fn(),
  };
}

function createAdapter(options = {}) {
  const container = document.createElement("div");
  container.tabIndex = -1;
  document.body.append(container);
  const api = options.api ?? createApi();
  const announce = options.announce ?? vi.fn();
  const adapter = createTurnstileAdapter({
    mode: "required",
    siteKey: SITE_KEY,
    container,
    announce,
    loadApi: vi.fn().mockResolvedValue(api),
    ...options,
  });

  return { adapter, announce, api, container };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("loadTurnstileApi", () => {
  it("never appends a provider script in off mode", async () => {
    const documentRef = createDocument();
    const append = vi.spyOn(documentRef.head, "append");

    await expect(
      loadTurnstileApi({ mode: "off", documentRef, windowRef: {} }),
    ).resolves.toBeNull();

    expect(append).not.toHaveBeenCalled();
    expect(documentRef.querySelector(`script[src='${SCRIPT_URL}']`)).toBeNull();
  });

  it("shares one explicit script load between two callers", async () => {
    const documentRef = createDocument();
    const windowRef = {};

    const first = loadTurnstileApi({
      mode: "observe",
      documentRef,
      windowRef,
    });
    const second = loadTurnstileApi({
      mode: "required",
      documentRef,
      windowRef,
    });
    const script = documentRef.querySelector("script");
    const api = createApi();

    expect(second).toBe(first);
    expect(documentRef.querySelectorAll("script")).toHaveLength(1);
    expect(script.src).toBe(SCRIPT_URL);

    windowRef.turnstile = api;
    script.dispatchEvent(new Event("load"));

    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("rejects script errors and permits a clean retry", async () => {
    const documentRef = createDocument();
    const windowRef = {};
    const first = loadTurnstileApi({
      mode: "observe",
      documentRef,
      windowRef,
    });
    const failedScript = documentRef.querySelector("script");

    failedScript.dispatchEvent(new Event("error"));

    await expect(first).rejects.toThrow(/load/i);
    expect(documentRef.querySelectorAll("script")).toHaveLength(0);

    const second = loadTurnstileApi({
      mode: "observe",
      documentRef,
      windowRef,
    });
    const retryScript = documentRef.querySelector("script");
    const api = createApi();

    expect(retryScript).not.toBe(failedScript);
    windowRef.turnstile = api;
    retryScript.dispatchEvent(new Event("load"));

    await expect(second).resolves.toBe(api);
  });

  it("rejects a bounded script-load timeout and permits retry", async () => {
    vi.useFakeTimers();
    const documentRef = createDocument();
    const windowRef = {};
    const first = loadTurnstileApi({
      mode: "required",
      documentRef,
      windowRef,
      timeoutMs: 500,
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(documentRef.querySelectorAll("script")).toHaveLength(1);

    const rejection = expect(first).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(documentRef.querySelectorAll("script")).toHaveLength(0);

    const retry = loadTurnstileApi({
      mode: "required",
      documentRef,
      windowRef,
      timeoutMs: 500,
    });
    const api = createApi();
    const script = documentRef.querySelector("script");
    windowRef.turnstile = api;
    script.dispatchEvent(new Event("load"));

    await expect(retry).resolves.toBe(api);
  });
});

describe("createTurnstileAdapter", () => {
  it("is inert in off mode", async () => {
    const loadApi = vi.fn();
    const { adapter, announce } = createAdapter({
      mode: "off",
      siteKey: "",
      loadApi,
    });

    await expect(adapter.ready).resolves.toBeUndefined();
    expect(adapter.required).toBe(false);
    expect(adapter.getToken()).toBe("");
    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      token: "",
    });
    expect(loadApi).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("renders with the exact explicit configuration contract", async () => {
    const { adapter, api, container } = createAdapter({ mode: "observe" });

    await adapter.ready;

    expect(api.render).toHaveBeenCalledOnce();
    expect(api.render.mock.calls[0][0]).toBe(container);
    const options = api.render.mock.calls[0][1];
    expect(options).toMatchObject({
      sitekey: SITE_KEY,
      action: "contact",
      theme: "dark",
      size: "flexible",
      "response-field": false,
      callback: expect.any(Function),
      "error-callback": expect.any(Function),
      "expired-callback": expect.any(Function),
      "timeout-callback": expect.any(Function),
      "unsupported-callback": expect.any(Function),
    });
    expect(Object.keys(options).sort()).toEqual(
      [
        "action",
        "callback",
        "error-callback",
        "expired-callback",
        "response-field",
        "sitekey",
        "size",
        "theme",
        "timeout-callback",
        "unsupported-callback",
      ].sort(),
    );
  });

  it("preserves a token delivered synchronously during explicit render", async () => {
    const api = createApi();
    api.render.mockImplementation((_container, options) => {
      options.callback("synchronous-token");
      return "widget-1";
    });
    const { adapter, announce } = createAdapter({ api });

    await adapter.ready;

    expect(adapter.getToken()).toBe("synchronous-token");
    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      state: "ready",
      token: "synchronous-token",
    });
    expect(announce).toHaveBeenLastCalledWith(
      "Security check complete. You can send your enquiry.",
    );
  });

  it("rejects a token when the initial render then throws", async () => {
    const api = createApi();
    api.render.mockImplementation((_container, options) => {
      options.callback("failed-initial-token");
      throw new Error("initial render failed after callback");
    });
    const { adapter } = createAdapter({ api });

    await adapter.ready;

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
  });

  it("stores a successful token and clears it on expiry or challenge timeout", async () => {
    const { adapter, api, announce } = createAdapter();
    await adapter.ready;
    const options = api.render.mock.calls[0][1];

    options.callback("token-123");
    expect(adapter.getToken()).toBe("token-123");
    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      token: "token-123",
    });
    expect(announce).toHaveBeenLastCalledWith(
      "Security check complete. You can send your enquiry.",
    );

    options["expired-callback"]();
    expect(adapter.getToken()).toBe("");
    expect(adapter.getSubmissionDecision()).toMatchObject({ allowed: false });
    expect(announce).toHaveBeenLastCalledWith(
      "The security check expired. Complete it again, then send your enquiry.",
    );

    options.callback("token-456");
    options["timeout-callback"]();
    expect(adapter.getToken()).toBe("");
    expect(adapter.getSubmissionDecision()).toMatchObject({ allowed: false });
    expect(announce).toHaveBeenLastCalledWith(
      "The security check timed out. Complete it again, then send your enquiry.",
    );
  });

  it.each([
    ["error-callback", "error", /could not load/i],
    ["unsupported-callback", "unsupported", /cannot run/i],
  ])(
    "records %s as %s and announces accessible recovery copy",
    async (callbackName, expectedState, messagePattern) => {
      const { adapter, api, announce } = createAdapter();
      await adapter.ready;
      const options = api.render.mock.calls[0][1];

      options.callback("temporary-token");
      options[callbackName]();

      expect(adapter.getToken()).toBe("");
      expect(adapter.getSubmissionDecision()).toMatchObject({
        allowed: false,
        state: expectedState,
      });
      expect(announce.mock.calls.at(-1)[0]).toMatch(messagePattern);
    },
  );

  it("announces load failure but allows observe mode to submit without a token", async () => {
    const { adapter, announce } = createAdapter({
      mode: "observe",
      loadApi: vi.fn().mockRejectedValue(new Error("script failed")),
    });

    await adapter.ready;

    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      state: "error",
      token: "",
    });
    expect(announce.mock.calls.at(-1)[0]).toMatch(
      /could not load.*still send/i,
    );
  });

  it.each([
    ["observe", true],
    ["required", false],
  ])(
    "treats a missing site key in %s mode as unavailable with allowed=%s",
    async (mode, allowed) => {
      const { adapter, announce } = createAdapter({ mode, siteKey: "" });

      await adapter.ready;

      expect(adapter.getSubmissionDecision()).toMatchObject({
        allowed,
        state: "unavailable",
        token: "",
      });
      expect(announce.mock.calls.at(-1)[0]).toMatch(
        mode === "observe" ? /not configured.*still send/i : /not configured/i,
      );
    },
  );

  it("blocks an unknown mode as an accessible configuration error", async () => {
    const loadApi = vi.fn();
    const { adapter, announce } = createAdapter({
      mode: "mystery",
      loadApi,
    });

    await adapter.ready;

    expect(adapter.required).toBe(true);
    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: false,
      state: "configuration-error",
      token: "",
    });
    expect(loadApi).not.toHaveBeenCalled();
    expect(announce.mock.calls.at(-1)[0]).toMatch(/not configured correctly/i);
  });

  it("refreshes a submitted token without overwriting the form outcome", async () => {
    const { adapter, api, announce } = createAdapter();
    await adapter.ready;
    const options = api.render.mock.calls[0][1];

    options.callback("submitted-token");
    announce.mockClear();

    adapter.reset();
    options.callback("refreshed-token");

    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      state: "ready",
      token: "refreshed-token",
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces a suppressed reset failure when the user retries", async () => {
    const { adapter, api, announce } = createAdapter();
    await adapter.ready;
    const options = api.render.mock.calls[0][1];

    options.callback("submitted-token");
    announce.mockClear();

    adapter.reset();
    options["error-callback"]();
    expect(announce).not.toHaveBeenCalled();

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
    expect(announce.mock.calls.at(-1)[0]).toMatch(/could not load/i);
  });

  it("resets and removes the rendered widget exactly once per call", async () => {
    const { adapter, api } = createAdapter();
    await adapter.ready;
    api.render.mock.calls[0][1].callback("token-123");

    adapter.reset();
    expect(adapter.getToken()).toBe("");
    expect(api.reset).toHaveBeenCalledOnce();
    expect(api.reset).toHaveBeenCalledWith("widget-1");

    adapter.destroy();
    adapter.destroy();
    expect(api.remove).toHaveBeenCalledOnce();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("re-renders the challenge when the provider reset throws", async () => {
    const api = createApi();
    api.render
      .mockReturnValueOnce("widget-1")
      .mockReturnValueOnce("widget-2");
    api.reset.mockImplementation(() => {
      throw new Error("provider reset failed");
    });
    const { adapter, announce, container } = createAdapter({ api });
    await adapter.ready;
    api.render.mock.calls[0][1].callback("one-use-token");
    announce.mockClear();

    expect(() => adapter.reset()).not.toThrow();
    expect(api.reset).toHaveBeenCalledOnce();
    expect(api.reset).toHaveBeenCalledWith("widget-1");
    expect(api.remove).toHaveBeenCalledOnce();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(api.render.mock.calls[1][0]).toBe(container);
    expect(adapter.getToken()).toBe("");

    api.render.mock.calls[1][1].callback("replacement-token");

    expect(adapter.getSubmissionDecision()).toMatchObject({
      allowed: true,
      state: "ready",
      token: "replacement-token",
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it("offers accessible recovery when reset and re-render both fail", async () => {
    const api = createApi();
    api.render
      .mockReturnValueOnce("widget-1")
      .mockImplementationOnce(() => {
        throw new Error("replacement render failed");
      });
    api.reset.mockImplementation(() => {
      throw new Error("provider reset failed");
    });
    const { adapter, announce } = createAdapter({ api });
    await adapter.ready;
    api.render.mock.calls[0][1].callback("one-use-token");
    announce.mockClear();

    adapter.reset();

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
    expect(announce.mock.calls.at(-1)[0]).toMatch(/refresh the page/i);
  });

  it("does not render over a stale challenge when removal fails", async () => {
    const api = createApi();
    api.reset.mockImplementation(() => {
      throw new Error("provider reset failed");
    });
    api.remove.mockImplementation(() => {
      throw new Error("provider remove failed");
    });
    const { adapter, announce } = createAdapter({ api });
    await adapter.ready;
    api.render.mock.calls[0][1].callback("one-use-token");
    announce.mockClear();

    adapter.reset();

    expect(api.render).toHaveBeenCalledOnce();
    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
    expect(announce.mock.calls.at(-1)[0]).toMatch(/refresh the page/i);
  });

  it("rejects a stale callback fired by a reset that then throws", async () => {
    const api = createApi();
    const { adapter } = createAdapter({ api });
    await adapter.ready;
    const originalOptions = api.render.mock.calls[0][1];
    originalOptions.callback("one-use-token");
    api.reset.mockImplementation(() => {
      originalOptions.callback("stale-token");
      throw new Error("provider reset failed after callback");
    });

    adapter.reset();

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "missing",
      token: "",
    });
  });

  it("ignores callbacks from a failed widget after replacement", async () => {
    const api = createApi();
    const { adapter } = createAdapter({ api });
    await adapter.ready;
    const originalOptions = api.render.mock.calls[0][1];
    originalOptions.callback("one-use-token");
    api.reset.mockImplementation(() => {
      throw new Error("provider reset failed");
    });

    adapter.reset();
    originalOptions.callback("late-stale-token");

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "missing",
      token: "",
    });

    api.render.mock.calls[1][1].callback("replacement-token");
    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: true,
      state: "ready",
      token: "replacement-token",
    });
  });

  it("rejects a replacement token when render then throws", async () => {
    const api = createApi();
    api.render
      .mockReturnValueOnce("widget-1")
      .mockImplementationOnce((_container, options) => {
        options.callback("failed-replacement-token");
        throw new Error("replacement render failed after callback");
      });
    api.reset.mockImplementation(() => {
      throw new Error("provider reset failed");
    });
    const { adapter } = createAdapter({ api });
    await adapter.ready;
    api.render.mock.calls[0][1].callback("one-use-token");

    adapter.reset();

    expect(adapter.prepareSubmission()).toMatchObject({
      allowed: false,
      state: "error",
      token: "",
    });
  });

  it("does not render after destruction while the loader is pending", async () => {
    const load = deferred();
    const api = createApi();
    const { adapter } = createAdapter({
      loadApi: vi.fn().mockReturnValue(load.promise),
    });

    adapter.destroy();
    load.resolve(api);
    await adapter.ready;

    expect(api.render).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("focuses an iframe when present and safely falls back to the wrapper", async () => {
    const { adapter, container } = createAdapter();
    await adapter.ready;
    const wrapperFocus = vi.spyOn(container, "focus");

    adapter.focus();
    expect(wrapperFocus).toHaveBeenCalledOnce();

    const iframe = document.createElement("iframe");
    const iframeFocus = vi.spyOn(iframe, "focus");
    container.append(iframe);
    adapter.focus();

    expect(iframeFocus).toHaveBeenCalledOnce();
    expect(wrapperFocus).toHaveBeenCalledOnce();
  });
});
