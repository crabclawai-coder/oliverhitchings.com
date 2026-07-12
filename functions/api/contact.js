const MAX_FIELD_LENGTH = 4_000;
const PROVIDER_TIMEOUT_MS = 5_000;
const RESEND_API_URL = "https://api.resend.com/emails";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const clean = (value) =>
  String(value || "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);

const cleanSingleLine = (value) =>
  String(value || "")
    .replace(/[\r\n]+/g, " ")
    .trim();

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const configurationError = () =>
  json(
    {
      message:
        "The website email destination is not configured yet. Please try again later.",
    },
    503,
  );

const deliveryError = () =>
  json(
    {
      message:
        "The website could not send the enquiry just now. Please try again later.",
    },
    502,
  );

export async function onRequestPost({ request, env }) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return json(
      { message: "The enquiry could not be read. Please try again." },
      400,
    );
  }

  if (clean(payload._honey)) {
    return json({ ok: true });
  }

  const enquiry = {
    name: clean(payload.name),
    email: cleanSingleLine(payload.email),
    contactNumber: cleanSingleLine(payload.contact_number),
    packageInterest: cleanSingleLine(payload.package_interest),
    automationRequest: clean(payload.automation_request),
    toolsInvolved: clean(payload.tools_involved),
  };

  if (
    !enquiry.name ||
    !isEmail(enquiry.email) ||
    !enquiry.packageInterest ||
    !enquiry.automationRequest
  ) {
    return json(
      {
        message:
          "Please complete your name, email, package interest, and automation request.",
      },
      400,
    );
  }

  const toEmail = cleanSingleLine(env.CONTACT_TO_EMAIL);
  if (!isEmail(toEmail)) {
    return configurationError();
  }

  if (typeof env.RESEND_API_KEY !== "string" || !env.RESEND_API_KEY.trim()) {
    return configurationError();
  }

  const fromEmail =
    cleanSingleLine(env.CONTACT_FROM_EMAIL) ||
    "Oliver Hitchings Website <contact@forms.oliverhitchings.com>";
  const submittedAt = new Date().toISOString();
  const subject = `Automation enquiry: ${enquiry.packageInterest}`;
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
  ].join("\n");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    let response;

    try {
      response = await fetch(RESEND_API_URL, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          reply_to: enquiry.email,
          subject,
          text,
        }),
        signal: controller.signal,
      });
    } catch {
      return deliveryError();
    }

    if (!response.ok) {
      return deliveryError();
    }

    let providerResult;
    try {
      providerResult = await response.json();
    } catch {
      return deliveryError();
    }

    if (
      providerResult === null ||
      typeof providerResult !== "object" ||
      Array.isArray(providerResult) ||
      typeof providerResult.id !== "string" ||
      !providerResult.id.trim()
    ) {
      return deliveryError();
    }

    return json({ ok: true });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function onRequest() {
  return json({ message: "Method not allowed" }, 405);
}
