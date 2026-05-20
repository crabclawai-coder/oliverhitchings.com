const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const MAX_FIELD_LENGTH = 4000;

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

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function onRequestPost({ request, env }) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return json({ message: "The enquiry could not be read. Please try again." }, 400);
  }

  if (clean(payload._honey)) {
    return json({ ok: true });
  }

  const enquiry = {
    name: clean(payload.name),
    email: clean(payload.email),
    contactNumber: clean(payload.contact_number),
    packageInterest: clean(payload.package_interest),
    automationRequest: clean(payload.automation_request),
    toolsInvolved: clean(payload.tools_involved),
  };

  if (!enquiry.name || !isEmail(enquiry.email) || !enquiry.packageInterest || !enquiry.automationRequest) {
    return json({ message: "Please complete your name, email, package interest, and automation request." }, 400);
  }

  const fromEmail = env.CONTACT_FROM_EMAIL || "Oliver Hitchings <onboarding@resend.dev>";
  const toEmail = env.CONTACT_TO_EMAIL || CONTACT_EMAIL;
  const submittedFrom = request.headers.get("CF-Connecting-IP") || "unknown";
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
    `Submitted from: ${submittedFrom}`,
  ].join("\n");

  if (!env.RESEND_API_KEY) {
    return json(
      {
        message:
          "The website email sender is not configured yet. Please email oliverhitch2008@gmail.com directly for now.",
      },
      503,
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
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
  });

  if (!response.ok) {
    return json(
      {
        message:
          "The website could not send the enquiry just now. Please email oliverhitch2008@gmail.com directly.",
      },
      502,
    );
  }

  return json({ ok: true });
}

export function onRequest() {
  return json({ message: "Method not allowed" }, 405);
}
