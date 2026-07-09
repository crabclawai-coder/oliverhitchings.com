import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { handleContactRequest } from "./index.js";

const ENDPOINT = "https://oliverhitchings.com/api/contact";
const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const FROM_EMAIL = "contact@oliverhitchings.com";
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

function createEmailFake({
  error,
  result = { messageId: "message-test-1" },
} = {}) {
  const send = error
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue(result);

  return {
    env: { CONTACT_EMAIL: { send } },
    send,
  };
}

function createLoggerFake({ infoError, errorError } = {}) {
  const info = vi.fn(() => {
    if (infoError) {
      throw infoError;
    }
  });
  const error = vi.fn(() => {
    if (errorError) {
      throw errorError;
    }
  });

  return {
    logger: { info, error },
    info,
    error,
  };
}

function createPostRequest(payload = VALID_PAYLOAD, options = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const url = options.url ?? ENDPOINT;
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: new URL(url).origin,
    ...options.headers,
  });

  if (options.omitOrigin) {
    headers.delete("Origin");
  }

  if (options.omitContentType) {
    headers.delete("Content-Type");
  }

  return new Request(url, {
    method: "POST",
    headers,
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
  const email = createEmailFake({
    error: options.emailError,
    result: options.emailResult,
  });
  const logging = options.captureLogs
    ? createLoggerFake(options.loggerErrors)
    : { logger: { info() {}, error() {} } };
  const request = createPostRequest(payload, options.request);
  const response = await handleContactRequest(request, email.env, {
    waitUntil: vi.fn(),
    logger: logging.logger,
  });

  return {
    ...email,
    ...logging,
    request,
    response,
    body: await response.json(),
  };
}

function expectCapturedLogsToExclude(
  logging,
  payload,
  connectingIp,
  extraForbiddenValues = [],
) {
  const serializedArguments = [logging.info, logging.error].flatMap((log) =>
    log.mock.calls.flatMap((call) =>
      call.map((argument) => JSON.stringify(argument) ?? String(argument)),
    ),
  );
  const forbiddenValues = [
    payload.name,
    payload.email,
    payload.contact_number,
    payload.automation_request,
    payload.tools_involved,
    CONTACT_EMAIL,
    FROM_EMAIL,
    connectingIp,
    ...extraForbiddenValues,
  ].filter(Boolean);

  expect(serializedArguments.length).toBeGreaterThan(0);
  for (const serializedArgument of serializedArguments) {
    for (const forbiddenValue of forbiddenValues) {
      expect(serializedArgument).not.toContain(forbiddenValue);
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("handleContactRequest request metadata", () => {
  it("rejects a cross-origin text/plain JSON POST before reading it", async () => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(VALID_PAYLOAD, {
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "text/plain",
      },
    });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(request.bodyUsed).toBe(false);
    expectStableError(body, "invalid_origin");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a POST with no Origin before reading it", async () => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(VALID_PAYLOAD, { omitOrigin: true });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(request.bodyUsed).toBe(false);
    expectStableError(body, "invalid_origin");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an apex request carrying the www Origin", async () => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(VALID_PAYLOAD, {
      headers: { Origin: "https://www.oliverhitchings.com" },
    });

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(request.bodyUsed).toBe(false);
    expectStableError(body, "invalid_origin");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing Content-Type", { omitContentType: true }],
    ["text/plain", { headers: { "Content-Type": "text/plain" } }],
    [
      "application/x-www-form-urlencoded",
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    ],
  ])("rejects %s before reading the body", async (_label, options) => {
    const { env, send } = createEmailFake();
    const request = createPostRequest(VALID_PAYLOAD, options);

    const response = await handleContactRequest(request, env, {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(request.bodyUsed).toBe(false);
    expectStableError(body, "invalid_content_type");
    expectJsonResponseHeaders(response);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["apex", ENDPOINT, "application/json"],
    [
      "www",
      "https://www.oliverhitchings.com/api/contact",
      "application/json; charset=utf-8",
    ],
  ])(
    "accepts a same-origin JSON POST on the %s host",
    async (_label, url, contentType) => {
      const { env, send } = createEmailFake();
      const request = createPostRequest(VALID_PAYLOAD, {
        url,
        headers: { "Content-Type": contentType },
      });

      const response = await handleContactRequest(request, env, {});

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        requestId: expect.any(String),
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );
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
      headers: {
        "Content-Type": "application/json",
        Origin: new URL(ENDPOINT).origin,
      },
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
    ["automation request", { automation_request: "\r\n \r\n\t\r\n" }],
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
    ["automation request", "automation_request", 4_000],
    ["tools involved", "tools_involved", 2_000],
  ])(
    "counts preserved leading and trailing LF in the %s limit",
    async (_label, field, limit) => {
      const atLimit = `\n${"x".repeat(limit - 2)}\n`;
      const overLimit = `\n${"x".repeat(limit - 1)}\n`;
      const accepted = await submit({ ...VALID_PAYLOAD, [field]: atLimit });

      expect(accepted.response.status).toBe(200);
      expect(accepted.send).toHaveBeenCalledOnce();

      const rejected = await submit({
        ...VALID_PAYLOAD,
        [field]: overLimit,
      });

      expect(rejected.response.status).toBe(400);
      expectStableError(rejected.body, "invalid_submission");
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
      automation_request: "\r\n  Line one\r\nLine two\rLine three  \r\n",
      tools_involved: "\r\n  Notion\r\nSheets\rAirtable  \r\n",
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
    const message = result.send.mock.calls[0][0];
    expect(message.subject).toBe("Automation enquiry: Task Map");
    expect(message.text).toContain("Name: Oliver Hitchings");
    expect(message.text).toContain("Email: oliver@example.com");
    expect(message.text).toContain("Contact number: 123 456");
    expect(message.text).toContain("Package interest: Task Map");

    const automationPrefix = "What they want automated:\n";
    const toolsMarker = "\n\nTools or systems involved:\n";
    const automationStart =
      message.text.indexOf(automationPrefix) + automationPrefix.length;
    const automationEnd = message.text.indexOf(toolsMarker, automationStart);
    expect(message.text.slice(automationStart, automationEnd)).toBe(
      "\n  Line one\nLine twoLine three  \n",
    );

    const toolsStart = automationEnd + toolsMarker.length;
    const toolsEnd = message.text.indexOf("\n\nSubmitted at:", toolsStart);
    expect(message.text.slice(toolsStart, toolsEnd)).toBe(
      "\n  Notion\nSheetsAirtable  \n",
    );
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
  it("sends the complete privacy-safe message and logs delivery metadata", async () => {
    const connectingIp = "203.0.113.42";
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      request: {
        headers: {
          "CF-Connecting-IP": connectingIp,
          "CF-Ray": "ray-test-123",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.send).toHaveBeenCalledWith({
      to: CONTACT_EMAIL,
      from: FROM_EMAIL,
      replyTo: VALID_PAYLOAD.email,
      subject: `Automation enquiry: ${VALID_PAYLOAD.package_interest}`,
      text: expect.any(String),
    });

    const { text } = result.send.mock.calls[0][0];
    expect(text).toContain(`Name: ${VALID_PAYLOAD.name}`);
    expect(text).toContain(`Email: ${VALID_PAYLOAD.email}`);
    expect(text).toContain(`Contact number: ${VALID_PAYLOAD.contact_number}`);
    expect(text).toContain(`Package interest: ${VALID_PAYLOAD.package_interest}`);
    expect(text).toContain(VALID_PAYLOAD.automation_request);
    expect(text).toContain(VALID_PAYLOAD.tools_involved);
    expect(text).toMatch(
      /^Submitted at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m,
    );
    expect(text).toContain(`Request ID: ${result.body.requestId}`);
    expect(text).not.toContain("Submitted from:");
    expect(text).not.toContain(connectingIp);

    expect(result.info).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_email_delivered",
      requestId: result.body.requestId,
      cfRay: "ray-test-123",
      messageId: "message-test-1",
    });
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp);
  });

  it("uses body and delivery-log fallbacks when optional values are unavailable", async () => {
    const payload = {
      _honey: "",
      name: VALID_PAYLOAD.name,
      email: VALID_PAYLOAD.email,
      package_interest: VALID_PAYLOAD.package_interest,
      automation_request: VALID_PAYLOAD.automation_request,
    };
    const result = await submit(payload, {
      captureLogs: true,
      emailResult: {},
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();

    const { text } = result.send.mock.calls[0][0];
    expect(text).toContain("Contact number: Not provided");
    expect(text).toContain("Tools or systems involved:\nNot provided");
    expect(result.info).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_email_delivered",
      requestId: result.body.requestId,
      cfRay: "unknown",
      messageId: "unavailable",
    });
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, payload);
  });

  it("returns stable 502 JSON and logs only a provider error code", async () => {
    const connectingIp = "198.51.100.77";
    const providerError = new Error(
      `provider message leaked ${VALID_PAYLOAD.name} ${VALID_PAYLOAD.email}`,
    );
    providerError.code = "provider_rejected";
    providerError.stack = `STACK_TOKEN ${VALID_PAYLOAD.contact_number}`;
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      emailError: providerError,
      request: {
        headers: {
          "CF-Connecting-IP": connectingIp,
          "CF-Ray": "ray-failure-456",
        },
      },
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledOnce();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "ray-failure-456",
      code: "provider_rejected",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp, [
      "provider message leaked",
      "STACK_TOKEN",
    ]);
  });

  it("falls back to unknown provider failure metadata", async () => {
    const providerError = new Error("provider unavailable");
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      emailError: providerError,
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledOnce();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "unknown",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      providerError.message,
    ]);
  });

  it("keeps a delivered response stable when success logging throws", async () => {
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      loggerErrors: { infoError: new Error("success logger unavailable") },
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledOnce();
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD);
  });

  it("keeps a provider-failure response stable when failure logging throws", async () => {
    const providerError = new Error("provider unavailable");
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      emailError: providerError,
      loggerErrors: { errorError: new Error("failure logger unavailable") },
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expectJsonResponseHeaders(result.response);
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledOnce();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      providerError.message,
    ]);
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
