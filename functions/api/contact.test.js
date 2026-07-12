import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./contact.js";

const ENDPOINT = "https://oliverhitchings.com/api/contact";
const VALID_PAYLOAD = {
  _honey: "",
  name: "Test visitor",
  email: "visitor@example.test",
  contact_number: "",
  package_interest: "Task Map",
  automation_request: "Automate a repeat report.",
  tools_involved: "Sheets",
};

function request(payload = VALID_PAYLOAD) {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("retained Pages contact fallback", () => {
  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["invalid", "not-an-email"],
    ["multi-line", "owner@example.test\r\nBcc: other@example.test"],
  ])("fails closed without exposing a destination when it is %s", async (_label, destination) => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: destination,
        RESEND_API_KEY: "test-provider-key",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      message: "The website email destination is not configured yet. Please try again later.",
    });
    expect(body.message).not.toContain("@");
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("uses only the configured destination and keeps it out of the public response", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-message-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const response = await onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: "owner@example.test",
        RESEND_API_KEY: "test-provider-key",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(providerFetch).toHaveBeenCalledOnce();
    const [, options] = providerFetch.mock.calls[0];
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(options.body)).toMatchObject({
      from: "Website <sender@example.test>",
      to: ["owner@example.test"],
      reply_to: VALID_PAYLOAD.email,
    });
  });

  it("uses generic provider-failure copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rejected", { status: 429 })),
    );

    const response = await onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: "owner@example.test",
        RESEND_API_KEY: "test-provider-key",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toBe("The website could not send the enquiry just now. Please try again later.");
    expect(body.message).not.toContain("@");
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
  ])("fails closed without calling the provider when its API key is %s", async (_label, apiKey) => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const response = await onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: "owner@example.test",
        RESEND_API_KEY: apiKey,
      },
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.message).toBe(
      "The website email destination is not configured yet. Please try again later.",
    );
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["network rejection", () => Promise.reject(new Error("offline"))],
    [
      "malformed JSON",
      () => Promise.resolve(new Response("not-json", { status: 200 })),
    ],
    [
      "an array response",
      () =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: "unexpected" }]), {
            status: 200,
          }),
        ),
    ],
    [
      "a missing provider ID",
      () => Promise.resolve(new Response("{}", { status: 200 })),
    ],
    [
      "a blank provider ID",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "   " }), { status: 200 }),
        ),
    ],
    [
      "a non-string provider ID",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ id: 123 }), { status: 200 }),
        ),
    ],
  ])("uses generic failure copy for %s", async (_label, fetchImplementation) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(fetchImplementation));

    const response = await onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: "owner@example.test",
        RESEND_API_KEY: "test-provider-key",
      },
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).toBe(
      "The website could not send the enquiry just now. Please try again later.",
    );
    expect(body.message).not.toContain("@");
  });

  it("aborts a slow provider after five seconds and reports generic failure", async () => {
    vi.useFakeTimers();
    let providerSignal;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
        providerSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    const pendingResponse = onRequestPost({
      request: request(),
      env: {
        CONTACT_FROM_EMAIL: "Website <sender@example.test>",
        CONTACT_TO_EMAIL: "owner@example.test",
        RESEND_API_KEY: "test-provider-key",
      },
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(providerSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pendingResponse;

    expect(providerSignal.aborted).toBe(true);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      message:
        "The website could not send the enquiry just now. Please try again later.",
    });
  });
});
