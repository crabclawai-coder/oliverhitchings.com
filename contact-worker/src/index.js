const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const FROM_EMAIL =
  "Oliver Hitchings Website <contact@forms.oliverhitchings.com>";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TURNSTILE_TOKEN_CHARACTERS = 2_048;
const RESEND_API_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 5_000;
const RESEND_USER_AGENT = "oliverhitchings-contact-worker/1.0";
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "contact";
const TURNSTILE_TIMEOUT_MS = 3_500;
const TURNSTILE_MAX_AGE_MS = 5 * 60 * 1_000;
const TURNSTILE_MAX_FUTURE_SKEW_MS = 60 * 1_000;

const ALLOWED_PACKAGES = new Set([
  "Task Map",
  "First Build",
  "Operator System",
  "Ongoing support",
  "Not sure yet",
]);

const FIELD_LIMITS = {
  name: 120,
  email: 254,
  contactNumber: 40,
  automationRequest: 4_000,
  toolsInvolved: 2_000,
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const ERRORS = {
  methodNotAllowed: {
    code: "method_not_allowed",
    message: "Only POST requests are accepted.",
  },
  invalidOrigin: {
    code: "invalid_origin",
    message: "The enquiry must be submitted from this website.",
  },
  invalidContentType: {
    code: "invalid_content_type",
    message: "The enquiry must be sent as JSON.",
  },
  payloadTooLarge: {
    code: "payload_too_large",
    message: "The enquiry is too large. Please shorten it and try again.",
  },
  invalidJson: {
    code: "invalid_json",
    message: "The enquiry could not be read. Please try again.",
  },
  invalidSubmission: {
    code: "invalid_submission",
    message:
      "Please complete your name, email, package interest, and automation request with valid details.",
  },
  rateLimited: {
    code: "rate_limited",
    message: "Too many enquiries were sent. Please wait a minute and try again.",
  },
  turnstileRequired: {
    code: "turnstile_required",
    message: "Please complete the website security check and try again.",
  },
  turnstileRejected: {
    code: "turnstile_rejected",
    message:
      "The website security check could not be confirmed. Please complete it again.",
  },
  turnstileUnavailable: {
    code: "turnstile_unavailable",
    message:
      "The website security check is temporarily unavailable. Please try again shortly.",
  },
  emailSendFailed: {
    code: "email_send_failed",
    message:
      "The website could not send the enquiry just now. Please email oliverhitch2008@gmail.com directly.",
  },
};

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });

const errorJson = (error, status, requestId, extraHeaders) =>
  json(
    {
      ok: false,
      code: error.code,
      message: error.message,
      requestId,
    },
    status,
    extraHeaders,
  );

const logSafely = (writeLog) => {
  try {
    writeLog();
  } catch {}
};

const isObjectPayload = (payload) =>
  payload !== null && typeof payload === "object" && !Array.isArray(payload);

const sendWithResend = async ({ apiKey, requestId, email }) => {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return { ok: false, code: "missing_secret" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);

  try {
    let response;

    try {
      response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": RESEND_USER_AGENT,
          "Idempotency-Key": `contact/${requestId}`,
        },
        body: JSON.stringify(email),
        signal: controller.signal,
      });
    } catch (error) {
      return {
        ok: false,
        code: error?.name === "AbortError" ? "timeout" : "network",
      };
    }

    if (!response.ok) {
      return { ok: false, code: "provider_non_2xx" };
    }

    let result;

    try {
      result = await response.json();
    } catch (error) {
      return {
        ok: false,
        code: error?.name === "AbortError" ? "timeout" : "malformed_response",
      };
    }

    if (!isObjectPayload(result)) {
      return { ok: false, code: "malformed_response" };
    }

    if (typeof result.id !== "string" || !result.id.trim()) {
      return { ok: false, code: "missing_message_id" };
    }

    return { ok: true, messageId: result.id };
  } finally {
    clearTimeout(timeoutId);
  }
};

const parseControlMode = (value) => {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "off"
  ) {
    return "off";
  }

  if (value === "observe" || value === "enforce") {
    return value;
  }

  return "invalid";
};

const logControl = (logger, level, entry) => {
  logSafely(() => {
    logger[level](entry);
  });
};

const applyRateLimit = async ({ request, env, logger, requestId, cfRay }) => {
  const mode = parseControlMode(env.RATE_LIMIT_MODE);

  if (mode === "off") {
    return false;
  }

  if (mode === "invalid") {
    logControl(logger, "error", {
      event: "contact_rate_limit_configuration",
      mode: "invalid",
      requestId,
      cfRay,
      outcome: "unavailable",
    });
    return false;
  }

  const connectingIp = request.headers.get("CF-Connecting-IP");
  const limiter = env.CONTACT_RATE_LIMITER;

  if (!connectingIp || typeof limiter?.limit !== "function") {
    logControl(logger, "error", {
      event: "contact_rate_limit",
      mode,
      requestId,
      cfRay,
      outcome: "unavailable",
    });
    return false;
  }

  let result;

  try {
    result = await limiter.limit({ key: connectingIp });
  } catch {
    logControl(logger, "error", {
      event: "contact_rate_limit",
      mode,
      requestId,
      cfRay,
      outcome: "unavailable",
    });
    return false;
  }

  if (
    !isObjectPayload(result) ||
    typeof result.success !== "boolean"
  ) {
    logControl(logger, "error", {
      event: "contact_rate_limit",
      mode,
      requestId,
      cfRay,
      outcome: "unavailable",
    });
    return false;
  }

  const outcome = result.success ? "allowed" : "limited";
  logControl(logger, "info", {
    event: "contact_rate_limit",
    mode,
    requestId,
    cfRay,
    outcome,
  });

  return mode === "enforce" && !result.success;
};

const parseAllowedHostnames = (value) => {
  if (typeof value !== "string") {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );
};

const rejectedTurnstileCodes = new Set([
  "missing-input-response",
  "invalid-input-response",
  "timeout-or-duplicate",
]);

const interpretSiteverifyResult = (result, allowedHostnames) => {
  if (!isObjectPayload(result) || typeof result.success !== "boolean") {
    return { outcome: "unavailable", reason: "malformed_response" };
  }

  if (!result.success) {
    const errorCodes = result["error-codes"];
    if (
      !Array.isArray(errorCodes) ||
      errorCodes.length === 0 ||
      !errorCodes.every(
        (code) => typeof code === "string" && rejectedTurnstileCodes.has(code),
      )
    ) {
      return { outcome: "unavailable", reason: "provider_unavailable" };
    }

    return { outcome: "rejected", reason: "token_rejected" };
  }

  if (result.action !== TURNSTILE_ACTION) {
    return { outcome: "rejected", reason: "action_mismatch" };
  }

  if (
    typeof result.hostname !== "string" ||
    !allowedHostnames.has(result.hostname)
  ) {
    return { outcome: "rejected", reason: "hostname_mismatch" };
  }

  const challengeTimestamp = Date.parse(result.challenge_ts);
  if (!Number.isFinite(challengeTimestamp)) {
    return { outcome: "rejected", reason: "invalid_timestamp" };
  }

  const now = Date.now();
  if (
    now - challengeTimestamp > TURNSTILE_MAX_AGE_MS ||
    challengeTimestamp - now > TURNSTILE_MAX_FUTURE_SKEW_MS
  ) {
    return { outcome: "rejected", reason: "invalid_timestamp" };
  }

  return { outcome: "accepted", reason: "verified" };
};

const verifyTurnstile = async ({
  token,
  secret,
  allowedHostnames,
  requestId,
}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  const body = new FormData();
  body.set("secret", secret);
  body.set("response", token);
  body.set("idempotency_key", requestId);

  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { outcome: "unavailable", reason: "non_2xx" };
    }

    let result;

    try {
      result = await response.json();
    } catch {
      return { outcome: "unavailable", reason: "malformed_response" };
    }

    return interpretSiteverifyResult(result, allowedHostnames);
  } catch (error) {
    return {
      outcome: "unavailable",
      reason: error?.name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const applyTurnstile = async ({ payload, env, logger, requestId, cfRay }) => {
  const mode = parseControlMode(env.TURNSTILE_MODE);

  if (mode === "off") {
    return null;
  }

  if (mode === "invalid") {
    logControl(logger, "error", {
      event: "contact_turnstile_configuration",
      mode: "invalid",
      requestId,
      cfRay,
      outcome: "unavailable",
      reason: "invalid_mode",
    });
    return errorJson(ERRORS.turnstileUnavailable, 503, requestId);
  }

  const secret = env.TURNSTILE_SECRET_KEY;
  const allowedHostnames = parseAllowedHostnames(
    env.TURNSTILE_ALLOWED_HOSTNAMES,
  );
  let result;

  if (!payload.turnstile_token) {
    result = { outcome: "rejected", reason: "missing_token" };
  } else if (typeof secret !== "string" || !secret.trim()) {
    result = { outcome: "unavailable", reason: "missing_secret" };
  } else if (allowedHostnames.size === 0) {
    result = { outcome: "unavailable", reason: "missing_hostnames" };
  } else {
    result = await verifyTurnstile({
      token: payload.turnstile_token,
      secret,
      allowedHostnames,
      requestId,
    });
  }

  logControl(
    logger,
    result.outcome === "unavailable" ? "error" : "info",
    {
      event: "contact_turnstile",
      mode,
      requestId,
      cfRay,
      outcome: result.outcome,
      reason: result.reason,
    },
  );

  if (mode === "observe" || result.outcome === "accepted") {
    return null;
  }

  if (result.reason === "missing_token") {
    return errorJson(ERRORS.turnstileRequired, 400, requestId);
  }

  if (result.outcome === "rejected") {
    return errorJson(ERRORS.turnstileRejected, 400, requestId);
  }

  return errorJson(ERRORS.turnstileUnavailable, 503, requestId);
};

const normalizeSingleLine = (value) =>
  value.replace(/[\r\n]+/g, " ").trim();

const normalizeMultiline = (value) => value.replace(/\r/g, "");

const characterCount = (value) => [...value].length;

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const hasValidFieldTypes = (payload) => {
  const requiredFields = [
    "name",
    "email",
    "package_interest",
    "automation_request",
  ];
  const optionalFields = [
    "contact_number",
    "tools_involved",
    "turnstile_token",
  ];

  return (
    requiredFields.every((field) => typeof payload[field] === "string") &&
    optionalFields.every(
      (field) => payload[field] === undefined || typeof payload[field] === "string",
    )
  );
};

const buildEnquiry = (payload) => ({
  name: normalizeSingleLine(payload.name),
  email: normalizeSingleLine(payload.email),
  contactNumber: normalizeSingleLine(payload.contact_number || ""),
  packageInterest: normalizeSingleLine(payload.package_interest),
  automationRequest: normalizeMultiline(payload.automation_request),
  toolsInvolved: normalizeMultiline(payload.tools_involved || ""),
});

const isValidEnquiry = (enquiry) =>
  Boolean(enquiry.name) &&
  isEmail(enquiry.email) &&
  ALLOWED_PACKAGES.has(enquiry.packageInterest) &&
  Boolean(enquiry.automationRequest.trim()) &&
  Object.entries(FIELD_LIMITS).every(
    ([field, limit]) => characterCount(enquiry[field]) <= limit,
  );

export async function handleContactRequest(request, env, context) {
  const requestId = crypto.randomUUID();

  if (request.method !== "POST") {
    return errorJson(ERRORS.methodNotAllowed, 405, requestId, {
      Allow: "POST",
    });
  }

  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return errorJson(ERRORS.invalidOrigin, 400, requestId);
  }

  const contentType = request.headers.get("Content-Type");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return errorJson(ERRORS.invalidContentType, 400, requestId);
  }

  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return errorJson(ERRORS.payloadTooLarge, 413, requestId);
  }

  let rawBody;

  try {
    rawBody = await request.text();
  } catch {
    return errorJson(ERRORS.invalidJson, 400, requestId);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorJson(ERRORS.payloadTooLarge, 413, requestId);
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorJson(ERRORS.invalidJson, 400, requestId);
  }

  if (!isObjectPayload(payload)) {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  if (payload._honey !== undefined && typeof payload._honey !== "string") {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  if (normalizeSingleLine(payload._honey || "")) {
    return json({ ok: true, requestId });
  }

  if (!hasValidFieldTypes(payload)) {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  if (
    payload.turnstile_token !== undefined &&
    characterCount(payload.turnstile_token) > MAX_TURNSTILE_TOKEN_CHARACTERS
  ) {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  const enquiry = buildEnquiry(payload);

  if (!isValidEnquiry(enquiry)) {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  const cfRay = request.headers.get("CF-Ray") || "unknown";
  const logger = context.logger ?? console;
  const rateLimited = await applyRateLimit({
    request,
    env,
    logger,
    requestId,
    cfRay,
  });

  if (rateLimited) {
    return errorJson(ERRORS.rateLimited, 429, requestId, {
      "Retry-After": "60",
    });
  }

  const turnstileResponse = await applyTurnstile({
    payload,
    env,
    logger,
    requestId,
    cfRay,
  });

  if (turnstileResponse) {
    return turnstileResponse;
  }

  const subject = `Automation enquiry: ${enquiry.packageInterest}`;
  const submittedAt = new Date().toISOString();
  const text = [
    "New automation enquiry from oliverhitchings.com",
    "",
    `Name: ${enquiry.name}`,
    `Email: ${enquiry.email}`,
    `Contact number: ${enquiry.contactNumber || "Not provided"}`,
    `Package interest: ${enquiry.packageInterest}`,
    "",
    "What they want automated:",
    enquiry.automationRequest,
    "",
    "Tools or systems involved:",
    enquiry.toolsInvolved || "Not provided",
    "",
    `Submitted at: ${submittedAt}`,
    `Request ID: ${requestId}`,
  ].join("\n");

  const result = await sendWithResend({
    apiKey: env.RESEND_API_KEY,
    requestId,
    email: {
      from: FROM_EMAIL,
      reply_to: enquiry.email,
      to: [CONTACT_EMAIL],
      subject,
      text,
    },
  });

  if (!result.ok) {
    logSafely(() => {
      logger.error({
        event: "contact_email_failed",
        requestId,
        cfRay,
        code: result.code,
      });
    });

    return errorJson(ERRORS.emailSendFailed, 502, requestId);
  }

  logSafely(() => {
    logger.info({
      event: "contact_email_accepted",
      provider: "resend",
      requestId,
      cfRay,
      messageId: result.messageId,
    });
  });

  return json({ ok: true, requestId });
}

export default {
  fetch(request, env, context) {
    return handleContactRequest(request, env, context);
  },
};
