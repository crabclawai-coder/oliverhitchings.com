const CONTACT_EMAIL = "oliverhitch2008@gmail.com";
const FROM_EMAIL = "contact@oliverhitchings.com";
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

const buildEnquiry = (payload) => ({
  name: clean(payload.name),
  email: clean(payload.email),
  contactNumber: clean(payload.contact_number),
  packageInterest: clean(payload.package_interest),
  automationRequest: clean(payload.automation_request),
  toolsInvolved: clean(payload.tools_involved),
});

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    if (request.method !== "POST") {
      return json({ message: "Method not allowed" }, 405);
    }

    let payload;

    try {
      payload = await request.json();
    } catch {
      return json({ message: "The enquiry could not be read. Please try again." }, 400);
    }

    if (clean(payload._honey)) {
      return json({ ok: true });
    }

    const enquiry = buildEnquiry(payload);

    if (!enquiry.name || !isEmail(enquiry.email) || !enquiry.packageInterest || !enquiry.automationRequest) {
      return json({ message: "Please complete your name, email, package interest, and automation request." }, 400);
    }

    const subject = `Automation enquiry: ${enquiry.packageInterest}`;
    const submittedFrom = request.headers.get("CF-Connecting-IP") || "unknown";
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
      `Submitted from: ${submittedFrom}`,
    ].join("\n");

    try {
      await env.CONTACT_EMAIL.send({
        to: CONTACT_EMAIL,
        from: FROM_EMAIL,
        subject,
        text,
      });
    } catch (error) {
      console.error("Contact email send failed", error instanceof Error ? error.message : error);
      return json(
        {
          message:
            "The website could not send the enquiry just now. Please email oliverhitch2008@gmail.com directly.",
        },
        502,
      );
    }

    return json({ ok: true });
  },
};
