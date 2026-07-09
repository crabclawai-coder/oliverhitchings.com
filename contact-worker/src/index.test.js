import { describe, expect, it, vi } from "vitest";
import worker, { handleContactRequest } from "./index.js";

const ENDPOINT = "https://oliverhitchings.com/api/contact";
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_PACKAGES = [
  "Task Map",
  "First Build",
  "Operator System",
  "Ongoing support",
  "Not sure yet",
];

const VALID_PAYLOAD = {
  _honey: "",
  name: "Oliver Hitchings",
  email: "oliver@example.com",
  contact_number: "+44 7700 900000",
  package_interest: "Task Map",
  automation_request: "Automate the weekly operations report.",
  tools_involved: "Notion and Google Sheets",
};

function createEmailFake(error) {
  const send = error
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue({ messageId: "message-test-1" });

  return {
    env: { CONTACT_EMAIL: { send } },
    send,
  };
}

function createPostRequest(payload = VALID_PAYLOAD, options = {}) {
  const body = options.body ?? JSON.stringify(payload);

  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body,
  });
}

function expectJsonResponseHeaders(response) {
  expect(response.headers.get("Content-Type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

function expectStableError(body, code) {
  expect(body).toEqual({
    ok: false,
    code,
    message: expect.any(String),
    requestId: expect.any(String),
  });
  expect(body.message.length).toBeGreaterThan(0);
  expect(body.requestId.length).toBeGreaterThan(0);
}

async function submit(payload = VALID_PAYLOAD, options = {}) {
  const email = createEmailFake(options.emailError);
  const request = createPostRequest(payload, options.request);
  const response = await handleContactRequest(request, email.env, {
    waitUntil: vi.fn(),
  });

  return {
    ...email,
    request,
    response,
    body: await response.json(),
  };
}

describe("handleContactRequest method contract", () => {
  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "rejects %s with 405 and an Allow header",
    async (method) => {
      const { env, send } = createEmailFake();
      const response = await handleContactRequest(
        new Request(ENDPOINT, { method }),
        env,
        {},
      );
      const body = await response.json();

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
      expectStableError(body, "method_not_allowed");
      expectJsonResponseHeaders(response);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("generates a distinct request ID for each request", async () => {
    const { env } = createEmailFake();
    const first = await handleContactRequest(
      new Request(ENDPOINT, { method: "GET" }),
      env,
      {},
    );
    const second = await handleContactRequest(
      new Request(ENDPOINT, { method: "GET" }),
      env,
      {},
    );

    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(firstBody.requestId).not.toBe(secondBody.requestId);
  });
});

describe("handleContactRequest body parsing", () => {
  it("rejects a declared body above 16 KiB before reading it", async () => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(VALID_PAYLOAD, {
      headers: { "Content-Length": String(MAX_BODY_BYTES + 1) },
    });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expectStableError(body, "payload_too_large");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts a body whose actual UTF-8 size is exactly 16 KiB", async () => {
    const { env, send } = createEmailFake();
    const json = JSON.stringify({ ...VALID_PAYLOAD, _honey: "bot" });
    const body = `${json}${" ".repeat(MAX_BODY_BYTES - json.length)}`;
    const request = createPostRequest(undefined, {
      body,
      headers: { "Content-Length": String(MAX_BODY_BYTES) },
    });

    const response = await handleContactRequest(request, env, {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an oversized UTF-8 body when Content-Length is missing", async () => {
    const oversizedBody = JSON.stringify({
      ...VALID_PAYLOAD,
      padding: "é".repeat(8_200),
    });
    expect(oversizedBody.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(oversizedBody).byteLength).toBeGreaterThan(
      MAX_BODY_BYTES,
    );

    const { env, send } = createEmailFake();
    const request = createPostRequest(undefined, { body: oversizedBody });
    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(true);
    expectStableError(body, "payload_too_large");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an oversized body when Content-Length is falsely small", async () => {
    const oversizedBody = `${JSON.stringify(VALID_PAYLOAD)}${" ".repeat(
      MAX_BODY_BYTES,
    )}`;
    const { env, send } = createEmailFake();
    const request = createPostRequest(undefined, {
      body: oversizedBody,
      headers: { "Content-Length": "1" },
    });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(413);
    expectStableError(body, "payload_too_large");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with stable JSON", async () => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(undefined, { body: "{not-json" });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expectStableError(body, "invalid_json");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a body that cannot be read", async () => {
    const stream = new ReadableStream({
      pull(controller) {
        controller.error(new Error("body stream failed"));
      },
    });
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });
    const { env, send } = createEmailFake();

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expectStableError(body, "invalid_json");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([null, [], "payload", 42])(
    "rejects the non-object JSON value %j",
    async (payload) => {
      const result = await submit(undefined, {
        request: { body: JSON.stringify(payload) },
      });

      expect(result.response.status).toBe(400);
      expectStableError(result.body, "invalid_submission");
      expectJsonResponseHeaders(result.response);
      expect(result.send).not.toHaveBeenCalled();
    },
  );
});

describe("handleContactRequest honeypot", () => {
  it("silently accepts a non-empty normalized honeypot without email", async () => {
    const result = await submit({
      _honey: "  spam\r\ntrap  ",
      name: "",
      email: "not-an-email",
      package_interest: "",
      automation_request: "",
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(result.response);
    expect(result.send).not.toHaveBeenCalled();
  });
});

describe("handleContactRequest field validation", () => {
  it.each([
    ["name", { name: " \r\n " }],
    ["email", { email: "" }],
    ["package", { package_interest: "" }],
    ["automation request", { automation_request: "\r\n" }],
  ])("requires %s", async (_label, change) => {
    const result = await submit({ ...VALID_PAYLOAD, ...change });

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "invalid_submission");
    expectJsonResponseHeaders(result.response);
    expect(result.send).not.toHaveBeenCalled();
  });

  it.each(["oliver", "@example.com", "oliver@", "oliver @example.com"])(
    "rejects the invalid email %j",
    async (email) => {
      const result = await submit({ ...VALID_PAYLOAD, email });

      expect(result.response.status).toBe(400);
      expectStableError(result.body, "invalid_submission");
      expect(result.send).not.toHaveBeenCalled();
    },
  );

  it.each(ALLOWED_PACKAGES)("accepts the exact package %j", async (packageInterest) => {
    const result = await submit({
      ...VALID_PAYLOAD,
      package_interest: packageInterest,
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expect(result.send).toHaveBeenCalledOnce();
  });

  it.each(["task map", "Task Maps", "Custom build", "Ongoing Support"])(
    "rejects the unlisted package %j",
    async (packageInterest) => {
      const result = await submit({
        ...VALID_PAYLOAD,
        package_interest: packageInterest,
      });

      expect(result.response.status).toBe(400);
      expectStableError(result.body, "invalid_submission");
      expect(result.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["name", "name", "n".repeat(120), "n".repeat(121)],
    [
      "email",
      "email",
      `${"e".repeat(242)}@example.com`,
      `${"e".repeat(243)}@example.com`,
    ],
    [
      "contact number",
      "contact_number",
      "1".repeat(40),
      "1".repeat(41),
    ],
    [
      "automation request",
      "automation_request",
      "a".repeat(4_000),
      "a".repeat(4_001),
    ],
    [
      "tools involved",
      "tools_involved",
      "t".repeat(2_000),
      "t".repeat(2_001),
    ],
  ])(
    "accepts %s at its character limit and rejects rather than truncates over it",
    async (_label, field, atLimit, overLimit) => {
      const accepted = await submit({ ...VALID_PAYLOAD, [field]: atLimit });

      expect(accepted.response.status).toBe(200);
      expect(accepted.send).toHaveBeenCalledOnce();

      const rejected = await submit({ ...VALID_PAYLOAD, [field]: overLimit });

      expect(rejected.response.status).toBe(400);
      expectStableError(rejected.body, "invalid_submission");
      expectJsonResponseHeaders(rejected.response);
      expect(rejected.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["name", { first: "Oliver" }],
    ["email", ["oliver@example.com"]],
    ["contact_number", 12345],
    ["package_interest", { package: "Task Map" }],
    ["automation_request", ["Automate it"]],
    ["tools_involved", { tool: "Notion" }],
  ])("rejects a non-string %s", async (field, value) => {
    const result = await submit({ ...VALID_PAYLOAD, [field]: value });

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "invalid_submission");
    expect(result.send).not.toHaveBeenCalled();
  });

  it("normalizes single-line fields and preserves multiline LF characters", async () => {
    const result = await submit({
      ...VALID_PAYLOAD,
      name: "  Oliver\r\n\rHitchings  ",
      email: "\r\noliver@example.com\r\n",
      contact_number: "123\r\n456",
      package_interest: "Task\r\nMap",
      automation_request: "  Line one\r\nLine two\rLine three  ",
      tools_involved: "  Notion\r\nSheets\rAirtable  ",
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
    const message = result.send.mock.calls[0][0];
    expect(message.subject).toBe("Automation enquiry: Task Map");
    expect(message.text).toContain("Name: Oliver Hitchings");
    expect(message.text).toContain("Email: oliver@example.com");
    expect(message.text).toContain("Contact number: 123 456");
    expect(message.text).toContain("Package interest: Task Map");
    expect(message.text).toContain("Line one\nLine twoLine three");
    expect(message.text).toContain("Notion\nSheetsAirtable");
  });

  it("rejects an email containing normalized header-injection text", async () => {
    const result = await submit({
      ...VALID_PAYLOAD,
      email: "oliver@example.com\r\nBcc: attacker@example.com",
    });

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "invalid_submission");
    expect(result.send).not.toHaveBeenCalled();
  });
});

describe("handleContactRequest email boundary and response schema", () => {
  it("sends once and returns stable success JSON", async () => {
    const result = await submit();

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();
  });

  it("returns stable 502 JSON when the email binding throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await submit(VALID_PAYLOAD, {
      emailError: new Error("provider unavailable"),
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });

  it("delegates the default Worker fetch handler to the request handler", async () => {
    const { env, send } = createEmailFake();
    const response = await worker.fetch(createPostRequest(), env, {
      waitUntil: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(response);
    expect(send).toHaveBeenCalledOnce();
  });
});
