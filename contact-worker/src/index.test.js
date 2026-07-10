import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { handleContactRequest } from "./index.js";

const ENDPOINT = "https://oliverhitchings.com/api/contact";
const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const FROM_EMAIL =
  "Oliver Hitchings Website <contact@forms.oliverhitchings.com>";
const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_API_KEY = "re_test_secret_value";
const RESEND_USER_AGENT = "oliverhitchings-contact-worker/1.0";
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_PACKAGES = [
  "Task Map",
  "First Build",
  "Operator System",
  "Ongoing support",
  "Not sure yet",
];
const VALID_TURNSTILE_TOKEN = "turnstile-token-test-value";

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
  result = { id: "message-test-1" },
} = {}) {
  const send = error
    ? vi.fn().mockRejectedValue(error)
    : vi.fn().mockResolvedValue(result);
  const upstreamFetch = globalThis.fetch;

  vi.stubGlobal("fetch", async (url, options) => {
    if (String(url) !== RESEND_API_URL) {
      return upstreamFetch(url, options);
    }

    const providerResult = await send(JSON.parse(options.body));
    return new Response(JSON.stringify(providerResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  return {
    env: { RESEND_API_KEY },
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

function createTurnstileResponse(overrides = {}, responseOptions = {}) {
  const body = {
    success: true,
    challenge_ts: new Date(Date.now() - 60_000).toISOString(),
    hostname: "oliverhitchings.com",
    action: "contact",
    "error-codes": [],
    ...overrides,
  };

  return new Response(
    responseOptions.rawBody ?? JSON.stringify(body),
    {
      status: responseOptions.status ?? 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function createTurnstileEnv(mode = "enforce", overrides = {}) {
  return {
    TURNSTILE_MODE: mode,
    TURNSTILE_SECRET_KEY: "turnstile-secret-test-value",
    TURNSTILE_ALLOWED_HOSTNAMES:
      " oliverhitchings.com,oliverhitchings.com,www.oliverhitchings.com ",
    ...overrides,
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
  const env = { ...email.env, ...options.env };
  const response = await handleContactRequest(request, env, {
    waitUntil: vi.fn(),
    logger: logging.logger,
  });

  return {
    ...email,
    ...logging,
    env,
    request,
    response,
    body: await response.json(),
  };
}

async function submitWithResend({
  fetchMock,
  apiKey = RESEND_API_KEY,
  omitApiKey = false,
  captureLogs = true,
  request = {},
} = {}) {
  const providerFetch =
    fetchMock ??
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "resend-message-test-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", providerFetch);
  const logging = captureLogs
    ? createLoggerFake()
    : { logger: { info() {}, error() {} } };
  const response = await handleContactRequest(
    createPostRequest(VALID_PAYLOAD, request),
    omitApiKey ? {} : { RESEND_API_KEY: apiKey },
    { logger: logging.logger },
  );

  return {
    ...logging,
    fetchMock: providerFetch,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

describe("handleContactRequest staged-control compatibility", () => {
  it.each([
    ["absent modes", {}],
    ["explicitly disabled modes", { TURNSTILE_MODE: "off", RATE_LIMIT_MODE: "off" }],
  ])("accepts a legacy tokenless payload with %s", async (_label, env) => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await submit(VALID_PAYLOAD, {
      env: { ...env, CONTACT_RATE_LIMITER: { limit } },
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
    expect(limit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts and ignores a token-bearing payload while controls are off", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: "off-mode-token" },
      {
        env: {
          TURNSTILE_MODE: "off",
          RATE_LIMIT_MODE: "off",
          CONTACT_RATE_LIMITER: { limit },
        },
      },
    );

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.send.mock.calls[0][0].text).not.toContain("off-mode-token");
    expect(limit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, 42, [], { token: "value" }])(
    "rejects the non-string Turnstile token %j",
    async (turnstileToken) => {
      const result = await submit({
        ...VALID_PAYLOAD,
        turnstile_token: turnstileToken,
      });

      expect(result.response.status).toBe(400);
      expectStableError(result.body, "invalid_submission");
      expect(result.send).not.toHaveBeenCalled();
    },
  );

  it("accepts 2,048 token characters and rejects 2,049", async () => {
    const accepted = await submit({
      ...VALID_PAYLOAD,
      turnstile_token: "🛡".repeat(2_048),
    });
    const rejected = await submit({
      ...VALID_PAYLOAD,
      turnstile_token: "🛡".repeat(2_049),
    });

    expect(accepted.response.status).toBe(200);
    expect(accepted.send).toHaveBeenCalledOnce();
    expect(rejected.response.status).toBe(400);
    expectStableError(rejected.body, "invalid_submission");
    expect(rejected.send).not.toHaveBeenCalled();
  });
});

describe("handleContactRequest rate limiting", () => {
  it("uses only CF-Connecting-IP as the key and logs an allowed observe result", async () => {
    const connectingIp = "203.0.113.50";
    const limit = vi.fn().mockResolvedValue({ success: true });
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: {
        RATE_LIMIT_MODE: "observe",
        CONTACT_RATE_LIMITER: { limit },
      },
      request: {
        headers: {
          "CF-Connecting-IP": connectingIp,
          "CF-Ray": "ray-rate-allowed",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(limit).toHaveBeenCalledOnce();
    expect(limit).toHaveBeenCalledWith({ key: connectingIp });
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_rate_limit",
      mode: "observe",
      requestId: result.body.requestId,
      cfRay: "ray-rate-allowed",
      outcome: "allowed",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp);
  });

  it("observes a limited result without blocking email", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: {
        RATE_LIMIT_MODE: "observe",
        CONTACT_RATE_LIMITER: { limit },
      },
      request: {
        headers: {
          "CF-Connecting-IP": "198.51.100.20",
          "CF-Ray": "ray-rate-observe-limited",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(limit).toHaveBeenCalledOnce();
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_rate_limit",
      mode: "observe",
      requestId: result.body.requestId,
      cfRay: "ray-rate-observe-limited",
      outcome: "limited",
    });
  });

  it("enforces a limited result with stable 429 JSON and skips later work", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: "valid-looking-token" },
      {
        captureLogs: true,
        env: {
          RATE_LIMIT_MODE: "enforce",
          TURNSTILE_MODE: "enforce",
          TURNSTILE_SECRET_KEY: "test-secret",
          TURNSTILE_ALLOWED_HOSTNAMES: "oliverhitchings.com",
          CONTACT_RATE_LIMITER: { limit },
        },
        request: {
          headers: {
            "CF-Connecting-IP": "192.0.2.12",
            "CF-Ray": "ray-rate-enforced",
          },
        },
      },
    );

    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("60");
    expectStableError(result.body, "rate_limited");
    expectJsonResponseHeaders(result.response);
    expect(limit).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.send).not.toHaveBeenCalled();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_rate_limit",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "ray-rate-enforced",
      outcome: "limited",
    });
  });

  it.each([
    ["missing binding", undefined, "203.0.113.1"],
    ["malformed result", { limit: vi.fn().mockResolvedValue({ allowed: true }) }, "203.0.113.2"],
    ["missing IP", { limit: vi.fn().mockResolvedValue({ success: false }) }, undefined],
  ])("fails open in enforce mode for %s", async (_label, binding, connectingIp) => {
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: {
        RATE_LIMIT_MODE: "enforce",
        ...(binding ? { CONTACT_RATE_LIMITER: binding } : {}),
      },
      request: {
        headers: {
          ...(connectingIp ? { "CF-Connecting-IP": connectingIp } : {}),
          "CF-Ray": "ray-rate-unavailable",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
    if (!connectingIp && binding) {
      expect(binding.limit).not.toHaveBeenCalled();
    }
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_rate_limit",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "ray-rate-unavailable",
      outcome: "unavailable",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp);
  });

  it("fails open and logs unavailable when the binding throws", async () => {
    const connectingIp = "198.51.100.44";
    const limit = vi.fn().mockRejectedValue(
      new Error(`binding leaked ${connectingIp} ${VALID_PAYLOAD.email}`),
    );
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: {
        RATE_LIMIT_MODE: "enforce",
        CONTACT_RATE_LIMITER: { limit },
      },
      request: {
        headers: {
          "CF-Connecting-IP": connectingIp,
          "CF-Ray": "ray-rate-thrown",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(limit).toHaveBeenCalledOnce();
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_rate_limit",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "ray-rate-thrown",
      outcome: "unavailable",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp, [
      "binding leaked",
    ]);
  });

  it("logs an unknown non-empty mode as a high-severity configuration event and fails open", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: {
        RATE_LIMIT_MODE: "ENFORCE",
        CONTACT_RATE_LIMITER: { limit },
      },
      request: {
        headers: {
          "CF-Connecting-IP": "203.0.113.8",
          "CF-Ray": "ray-rate-invalid-mode",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
    expect(result.send).toHaveBeenCalledOnce();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_rate_limit_configuration",
      mode: "invalid",
      requestId: result.body.requestId,
      cfRay: "ray-rate-invalid-mode",
      outcome: "unavailable",
    });
  });

  it("never calls the limiter for invalid or honeypot submissions", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      ...createTurnstileEnv(),
      RATE_LIMIT_MODE: "enforce",
      CONTACT_RATE_LIMITER: { limit },
    };
    const request = {
      headers: { "CF-Connecting-IP": "192.0.2.99" },
    };

    const invalid = await submit(
      { ...VALID_PAYLOAD, email: "invalid" },
      { env, request },
    );
    const honeypot = await submit(
      {
        ...VALID_PAYLOAD,
        _honey: "filled",
        turnstile_token: { ignored: true },
      },
      { env, request },
    );

    expect(invalid.response.status).toBe(400);
    expect(honeypot.response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invalid.send).not.toHaveBeenCalled();
    expect(honeypot.send).not.toHaveBeenCalled();
  });

  it("keeps the enforced 429 response stable when control logging throws", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      loggerErrors: { infoError: new Error("rate logger unavailable") },
      env: {
        RATE_LIMIT_MODE: "enforce",
        CONTACT_RATE_LIMITER: { limit },
      },
      request: {
        headers: { "CF-Connecting-IP": "192.0.2.77" },
      },
    });

    expect(result.response.status).toBe(429);
    expectStableError(result.body, "rate_limited");
    expect(result.send).not.toHaveBeenCalled();
    expect(limit).toHaveBeenCalledOnce();
  });
});

describe("handleContactRequest Turnstile validation", () => {
  it("accepts one valid contact token and sends the request ID without remote IP", async () => {
    const connectingIp = "203.0.113.70";
    const fetchMock = vi.fn().mockResolvedValue(createTurnstileResponse());
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        env: createTurnstileEnv(),
        request: {
          headers: {
            "CF-Connecting-IP": connectingIp,
            "CF-Ray": "ray-turnstile-accepted",
          },
        },
      },
    );

    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.send).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(options.method).toBe("POST");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("secret")).toBe("turnstile-secret-test-value");
    expect(options.body.get("response")).toBe(VALID_TURNSTILE_TOKEN);
    expect(options.body.get("idempotency_key")).toBe(result.body.requestId);
    expect(options.body.has("remoteip")).toBe(false);
    expect(result.send.mock.calls[0][0].text).not.toContain(
      VALID_TURNSTILE_TOKEN,
    );
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_turnstile",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "ray-turnstile-accepted",
      outcome: "accepted",
      reason: "verified",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp, [
      VALID_TURNSTILE_TOKEN,
      "turnstile-secret-test-value",
    ]);
  });

  it.each([
    ["observe", 200, true],
    ["enforce", 400, false],
  ])(
    "handles a missing token in %s mode",
    async (mode, expectedStatus, shouldSend) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const result = await submit(VALID_PAYLOAD, {
        captureLogs: true,
        env: createTurnstileEnv(mode),
        request: { headers: { "CF-Ray": "ray-turnstile-missing" } },
      });

      expect(result.response.status).toBe(expectedStatus);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.send).toHaveBeenCalledTimes(shouldSend ? 1 : 0);
      if (mode === "enforce") {
        expectStableError(result.body, "turnstile_required");
      }
      expect(result.info).toHaveBeenCalledWith({
        event: "contact_turnstile",
        mode,
        requestId: result.body.requestId,
        cfRay: "ray-turnstile-missing",
        outcome: "rejected",
        reason: "missing_token",
      });
    },
  );

  it("returns token-required before checking optional Turnstile configuration", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(VALID_PAYLOAD, {
      captureLogs: true,
      env: createTurnstileEnv("enforce", {
        TURNSTILE_SECRET_KEY: undefined,
        TURNSTILE_ALLOWED_HOSTNAMES: undefined,
      }),
    });

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "turnstile_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.send).not.toHaveBeenCalled();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_turnstile",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "unknown",
      outcome: "rejected",
      reason: "missing_token",
    });
    expect(result.error).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid-input-response", "invalid token"],
    ["timeout-or-duplicate", "expired or duplicate token"],
  ])("rejects an enforced %s result", async (errorCode) => {
    const fetchMock = vi.fn().mockResolvedValue(
      createTurnstileResponse({
        success: false,
        "error-codes": [errorCode],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        env: createTurnstileEnv(),
      },
    );

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "turnstile_rejected");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.send).not.toHaveBeenCalled();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_turnstile",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "unknown",
      outcome: "rejected",
      reason: "token_rejected",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      VALID_TURNSTILE_TOKEN,
      errorCode,
    ]);
  });

  it.each([
    ["wrong action", { action: "login" }],
    ["wrong hostname", { hostname: "attacker.example" }],
    ["invalid timestamp", { challenge_ts: "not-a-date" }],
    [
      "old timestamp",
      { challenge_ts: new Date(Date.now() - 360_000).toISOString() },
    ],
    [
      "future timestamp",
      { challenge_ts: new Date(Date.now() + 120_000).toISOString() },
    ],
  ])("rejects a successful Siteverify response with %s", async (_label, overrides) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createTurnstileResponse(overrides));
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      { env: createTurnstileEnv() },
    );

    expect(result.response.status).toBe(400);
    expectStableError(result.body, "turnstile_rejected");
    expect(result.send).not.toHaveBeenCalled();
  });

  it.each([
    ["five-minute boundary", -300_000],
    ["future-skew boundary", 60_000],
  ])("accepts the exact %s timestamp", async (_label, offset) => {
    vi.useFakeTimers();
    const now = Date.parse("2026-07-10T00:00:00.000Z");
    vi.setSystemTime(now);
    const challengeTs = new Date(now + offset).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      createTurnstileResponse({ challenge_ts: challengeTs }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      { env: createTurnstileEnv() },
    );

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing secret", { TURNSTILE_SECRET_KEY: undefined }, "missing_secret"],
    ["blank secret", { TURNSTILE_SECRET_KEY: "   " }, "missing_secret"],
    [
      "missing hostname allowlist",
      { TURNSTILE_ALLOWED_HOSTNAMES: undefined },
      "missing_hostnames",
    ],
    [
      "empty hostname allowlist",
      { TURNSTILE_ALLOWED_HOSTNAMES: " , , " },
      "missing_hostnames",
    ],
  ])("treats %s as unavailable configuration", async (_label, envChange, reason) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        env: createTurnstileEnv("enforce", envChange),
      },
    );

    expect(result.response.status).toBe(503);
    expectStableError(result.body, "turnstile_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.send).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_turnstile",
      mode: "enforce",
      requestId: result.body.requestId,
      cfRay: "unknown",
      outcome: "unavailable",
      reason,
    });
  });

  it.each([
    ["internal-error"],
    ["missing-input-secret"],
    ["invalid-input-secret"],
    ["bad-request"],
    ["unknown-provider-code"],
  ])("maps the provider code %s to unavailable without exposing it", async (errorCode) => {
    const fetchMock = vi.fn().mockResolvedValue(
      createTurnstileResponse({
        success: false,
        "error-codes": [errorCode],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        env: createTurnstileEnv(),
      },
    );

    expect(result.response.status).toBe(503);
    expectStableError(result.body, "turnstile_unavailable");
    expect(result.send).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      errorCode,
      VALID_TURNSTILE_TOKEN,
      "turnstile-secret-test-value",
    ]);
  });

  it.each([
    [
      "non-2xx response",
      () => Promise.resolve(createTurnstileResponse({}, { status: 503 })),
    ],
    [
      "malformed JSON",
      () =>
        Promise.resolve(
          createTurnstileResponse({}, { rawBody: "{not-json" }),
        ),
    ],
    [
      "non-object JSON",
      () => Promise.resolve(new Response("[]", { status: 200 })),
    ],
    ["fetch rejection", () => Promise.reject(new Error("network failed"))],
  ])("treats %s as unavailable in enforce mode", async (_label, implementation) => {
    const fetchMock = vi.fn().mockImplementation(implementation);
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      { env: createTurnstileEnv() },
    );

    expect(result.response.status).toBe(503);
    expectStableError(result.body, "turnstile_unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.send).not.toHaveBeenCalled();
  });

  it("aborts Siteverify after 3.5 seconds without retrying", async () => {
    vi.useFakeTimers();
    let capturedSignal;
    const fetchMock = vi.fn((_url, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const responsePromise = submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      { env: createTurnstileEnv() },
    );

    await vi.advanceTimersByTimeAsync(3_499);
    expect(capturedSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await responsePromise;

    expect(capturedSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.response.status).toBe(503);
    expectStableError(result.body, "turnstile_unavailable");
    expect(result.send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing token",
      VALID_PAYLOAD,
      vi.fn(),
    ],
    [
      "rejected token",
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      vi.fn().mockResolvedValue(
        createTurnstileResponse({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      ),
    ],
    [
      "unavailable verification",
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      vi.fn().mockRejectedValue(new Error("offline")),
    ],
    [
      "missing configuration",
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      vi.fn(),
    ],
  ])("observe mode never blocks email for %s", async (label, payload, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);
    const env = createTurnstileEnv(
      "observe",
      label === "missing configuration"
        ? { TURNSTILE_SECRET_KEY: undefined }
        : {},
    );
    const result = await submit(payload, { env });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();
  });

  it("rejects an unknown non-empty mode as a configuration failure", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        env: createTurnstileEnv("ENFORCE"),
        request: { headers: { "CF-Ray": "ray-turnstile-invalid-mode" } },
      },
    );

    expect(result.response.status).toBe(503);
    expectStableError(result.body, "turnstile_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.send).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_turnstile_configuration",
      mode: "invalid",
      requestId: result.body.requestId,
      cfRay: "ray-turnstile-invalid-mode",
      outcome: "unavailable",
      reason: "invalid_mode",
    });
  });

  it("runs the limiter before Siteverify for meaningful valid data", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const fetchMock = vi.fn().mockResolvedValue(createTurnstileResponse());
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        env: {
          ...createTurnstileEnv(),
          RATE_LIMIT_MODE: "enforce",
          CONTACT_RATE_LIMITER: { limit },
        },
        request: { headers: { "CF-Connecting-IP": "192.0.2.40" } },
      },
    );

    expect(result.response.status).toBe(200);
    expect(limit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(limit.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
    expect(result.send).toHaveBeenCalledOnce();
  });

  it("keeps responses stable and provider calls singular when control logs throw", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTurnstileResponse());
    vi.stubGlobal("fetch", fetchMock);
    const result = await submit(
      { ...VALID_PAYLOAD, turnstile_token: VALID_TURNSTILE_TOKEN },
      {
        captureLogs: true,
        loggerErrors: { infoError: new Error("control logger unavailable") },
        env: createTurnstileEnv(),
      },
    );

    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.send).toHaveBeenCalledOnce();
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
      from: FROM_EMAIL,
      reply_to: VALID_PAYLOAD.email,
      to: [CONTACT_EMAIL],
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
      event: "contact_email_accepted",
      provider: "resend",
      requestId: result.body.requestId,
      cfRay: "ray-test-123",
      messageId: "message-test-1",
    });
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp);
  });

  it("uses body fallbacks when optional enquiry values are unavailable", async () => {
    const payload = {
      _honey: "",
      name: VALID_PAYLOAD.name,
      email: VALID_PAYLOAD.email,
      package_interest: VALID_PAYLOAD.package_interest,
      automation_request: VALID_PAYLOAD.automation_request,
    };
    const result = await submit(payload, {
      captureLogs: true,
    });

    expect(result.response.status).toBe(200);
    expect(result.send).toHaveBeenCalledOnce();

    const { text } = result.send.mock.calls[0][0];
    expect(text).toContain("Contact number: Not provided");
    expect(text).toContain("Tools or systems involved:\nNot provided");
    expect(result.info).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_email_accepted",
      provider: "resend",
      requestId: result.body.requestId,
      cfRay: "unknown",
      messageId: "message-test-1",
    });
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, payload);
  });

  it("returns stable 502 JSON and classifies a provider rejection as a network failure", async () => {
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
      code: "network",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp, [
      "provider message leaked",
      "provider_rejected",
      "STACK_TOKEN",
    ]);
  });

  it("classifies a plain provider exception as a network failure", async () => {
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
      code: "network",
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

describe("handleContactRequest Resend delivery boundary", () => {
  it("posts the exact enquiry to Resend with private authentication and idempotency", async () => {
    const connectingIp = "203.0.113.91";
    const result = await submitWithResend({
      request: {
        headers: {
          "CF-Connecting-IP": connectingIp,
          "CF-Ray": "ray-resend-success",
        },
      },
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      requestId: expect.any(String),
    });
    expect(result.fetchMock).toHaveBeenCalledOnce();
    const [url, options] = result.fetchMock.mock.calls[0];
    expect(url).toBe(RESEND_API_URL);
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": RESEND_USER_AGENT,
        "Idempotency-Key": `contact/${result.body.requestId}`,
      },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(options.body)).toEqual({
      from: FROM_EMAIL,
      reply_to: VALID_PAYLOAD.email,
      to: [CONTACT_EMAIL],
      subject: `Automation enquiry: ${VALID_PAYLOAD.package_interest}`,
      text: expect.any(String),
    });
    expect(result.info).toHaveBeenCalledOnce();
    expect(result.info).toHaveBeenCalledWith({
      event: "contact_email_accepted",
      provider: "resend",
      requestId: result.body.requestId,
      cfRay: "ray-resend-success",
      messageId: "resend-message-test-1",
    });
    expect(result.error).not.toHaveBeenCalled();
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, connectingIp, [
      RESEND_API_KEY,
      FROM_EMAIL,
    ]);
  });

  it("returns the honest 502 response without a provider call when the API secret is missing", async () => {
    const result = await submitWithResend({ omitApiKey: true });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.fetchMock).not.toHaveBeenCalled();
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "missing_secret",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD);
  });

  it("aborts Resend after roughly five seconds and reports a privacy-safe timeout", async () => {
    vi.useFakeTimers();
    let providerSignal;
    const fetchMock = vi.fn((_url, options) => {
      providerSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(new DOMException("request timed out", "AbortError"));
        });
      });
    });

    const pending = submitWithResend({ fetchMock });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(providerSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(providerSignal.aborted).toBe(true);
    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "timeout",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      RESEND_API_KEY,
    ]);
  });

  it("turns a Resend network error into a privacy-safe 502", async () => {
    const leakedProviderError = new Error(
      `network leaked ${VALID_PAYLOAD.email} ${RESEND_API_KEY}`,
    );
    const result = await submitWithResend({
      fetchMock: vi.fn().mockRejectedValue(leakedProviderError),
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "network",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      RESEND_API_KEY,
      "network leaked",
    ]);
  });

  it("does not trust or log a non-2xx Resend response", async () => {
    const providerBody = `rejected ${VALID_PAYLOAD.email} ${RESEND_API_KEY}`;
    const result = await submitWithResend({
      fetchMock: vi.fn().mockResolvedValue(
        new Response(providerBody, {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "provider_non_2xx",
    });
    expectCapturedLogsToExclude(result, VALID_PAYLOAD, undefined, [
      RESEND_API_KEY,
      providerBody,
    ]);
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["a JSON array", JSON.stringify([{ id: "message-array" }])],
  ])("rejects a 2xx Resend response containing %s", async (_label, body) => {
    const result = await submitWithResend({
      fetchMock: vi.fn().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "malformed_response",
    });
  });

  it.each([
    ["missing", {}],
    ["empty", { id: "" }],
    ["whitespace-only", { id: "   " }],
    ["non-string", { id: 123 }],
  ])("rejects a 2xx Resend response with a %s message ID", async (_label, body) => {
    const result = await submitWithResend({
      fetchMock: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    expect(result.response.status).toBe(502);
    expectStableError(result.body, "email_send_failed");
    expect(result.info).not.toHaveBeenCalled();
    expect(result.error).toHaveBeenCalledWith({
      event: "contact_email_failed",
      requestId: result.body.requestId,
      cfRay: "unknown",
      code: "missing_message_id",
    });
  });
});
