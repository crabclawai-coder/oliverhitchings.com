const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const FROM_EMAIL = "contact@oliverhitchings.com";
const MAX_BODY_BYTES = 16 * 1024;

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

const normalizeSingleLine = (value) =>
  value.replace(/[\r\n]+/g, " ").trim();

const normalizeMultiline = (value) => value.replace(/\r/g, "");

const characterCount = (value) => [...value].length;

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isObjectPayload = (payload) =>
  payload !== null && typeof payload === "object" && !Array.isArray(payload);

const hasValidFieldTypes = (payload) => {
  const requiredFields = [
    "name",
    "email",
    "package_interest",
    "automation_request",
  ];
  const optionalFields = ["contact_number", "tools_involved"];

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

  const enquiry = buildEnquiry(payload);

  if (!isValidEnquiry(enquiry)) {
    return errorJson(ERRORS.invalidSubmission, 400, requestId);
  }

  const subject = `Automation enquiry: ${enquiry.packageInterest}`;
  const submittedAt = new Date().toISOString();
  const cfRay = request.headers.get("CF-Ray") || "unknown";
  const logger = context.logger ?? console;
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

  let result;

  try {
    result = await env.CONTACT_EMAIL.send({
      to: CONTACT_EMAIL,
      from: FROM_EMAIL,
      replyTo: enquiry.email,
      subject,
      text,
    });
  } catch (error) {
    logSafely(() => {
      logger.error({
        event: "contact_email_failed",
        requestId,
        cfRay,
        code:
          typeof error?.code === "string" && error.code
            ? error.code
            : "unknown",
      });
    });

    return errorJson(ERRORS.emailSendFailed, 502, requestId);
  }

  logSafely(() => {
    logger.info({
      event: "contact_email_delivered",
      requestId,
      cfRay,
      messageId: result?.messageId || "unavailable",
    });
  });

  return json({ ok: true, requestId });
}

export default {
  fetch(request, env, context) {
    return handleContactRequest(request, env, context);
  },
};
