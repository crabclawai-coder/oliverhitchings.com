# Oliver Hitchings website enquiry repair and redesign

Date: 9 July 2026

Status: Approved direction; written specification pending final review

Canonical site: `https://oliverhitchings.com`

## 1. Objective

Make the site a stronger, more credible founder-led automation consultancy and make its enquiry form a dependable production path. A visitor must be able to complete the form, submit it without opening a mail application, receive honest success or failure feedback, and have the enquiry delivered to Oliver's existing inbox.

The redesign should preserve the site's strongest characteristic—its dark, cinematic, technically minded visual language—while making Oliver Hitchings unmistakable, replacing generic feature-card patterns with evidence of how the work operates, and improving accessibility, performance, SEO, and operational visibility.

## 2. Evidence and constraints

### Current production architecture

- Astro 6 static site deployed from GitHub `crabclawai-coder/oliverhitchings.com` to Cloudflare Pages project `oliverhitchings`.
- Cloudflare Worker `oliverhitchings-contact` owns `POST /api/contact` for the apex and `www` hosts.
- The Worker is configured to send through Cloudflare's email binding from `contact@oliverhitchings.com` to the existing configured inbox; actual delivery was unverified when this specification was drafted.
- A second Pages/Resend contact implementation remains in the repository but is not the intended production path.
- Cloudflare Pages and the contact Worker were last changed roughly two months before this review.

Drive searches for the domain, Cloudflare Pages, Astro, Railway, Resend, FormSubmit, and the contact Worker found no relevant technical documentation. Hermes/Claude memory indexes also contained no website-specific record. The repository, its workflow, and the live Cloudflare configuration are therefore the source of truth. No credentials will be copied into the repository or documentation.

### Live findings

- The form currently displays success and clears the user's data before the network request finishes, then ignores failures.
- The live endpoint is reachable and validates malformed submissions, but no real delivery test has yet been sent.
- A labelled production delivery test at 19:37:36 UTC on 9 July 2026 returned HTTP `502`; Cloudflare did not return a provider message ID, so provider acceptance and inbox receipt both remain unconfirmed.
- Public DNS shows the root domain's existing MX and SPF records belong to its current external mail host. Cloudflare Email Sending's required `cf-bounce` SPF, DKIM, and MX records are not publicly present, making incomplete Email Sending onboarding the leading hypothesis until the Worker error log confirms it.
- Cloudflare account Analytics, inspected on 9 July 2026 for its rolling seven-day window, showed 17.71k requests, 289.74 MB bandwidth, and 7.48k request-derived visits, with a traffic pattern dominated by automated or scanner activity.
- Cloudflare Web Analytics, inspected on 9 July 2026 with `excludeBots=Yes` and a 10,080-minute rolling window, showed four visits and four pageviews. These are bot-filtered analytics events, not proof of four individual humans. With a four-view sample, its 632 ms LCP and good CLS are encouraging but not statistically meaningful.
- The homepage ships about 21.8 MiB across five MP4 files.
- The clean baseline build passes, but the dependency audit reports four advisories (one low, one moderate, and two high) that need package-by-package review rather than an automatic breaking upgrade.
- `robots.txt` falls through to the homepage, unknown URLs return the homepage with status 200, `/sitemap.xml` soft-falls through, social images are absent, and dated May 2026 copy is stale.
- The live site is fast at the edge and has no observed 5xx traffic. The priority is trust, discoverability, conversion, and media efficiency—not server scaling.

## 3. Product and content direction

### Positioning

The first screen must answer three questions without scrolling:

1. Who is this? Oliver Hitchings.
2. What does he build? Small, inspectable automation systems for repeat business work.
3. Why trust the approach? Human review, visible logs, explicit ownership, and a demonstrable internal operating stack.

The primary message remains practical ownership rather than novelty. The site must not claim client results, time savings, testimonials, or commercial case studies that are not documented.

### Homepage structure

1. **Branded hero.** Keep one cinematic hero video, add a visible Oliver Hitchings wordmark, tighten the headline, and show a compact operator-trace panel that demonstrates inputs, review, action, and logging.
2. **Proof rail.** Use only verified facts: one workflow selected before building and the three handover assets (prompts, logs, runbook). Retain the existing “40+ internal automations” claim only if it is verified against a named operating inventory before publication; otherwise use non-numeric wording.
3. **From repeat task to owned loop.** Replace the generic service-card row with a horizontal operating-flow explanation: intake → classify → human review → action → evidence.
4. **Selected system patterns.** Show inbox triage, research monitoring, and recurring reporting as transparent examples of systems Oliver builds and operates. These are system patterns, not invented client case studies.
5. **Packages.** Retain the three clear price points and optional retainer, but make comparison easier and remove date-specific pricing language.
6. **Operating principles.** Present inspectability, failure handling, and handover as editorial rows rather than another grid of cards.
7. **Focused final call to action.** Link directly to the enquiry form and keep the contact path on the website.

### Supporting pages

- Services keeps full package detail and becomes the primary enquiry page.
- About becomes more clearly founder-led, with visible Oliver Hitchings identity and concrete operating principles.
- Blog retains existing content but adopts the same typography, spacing, navigation, and metadata system.
- The stale `/now` and `/pilot` redirects remain intentional.
- A designed 404 page explains the missing route and links visitors back to useful pages.

## 4. Visual system

### Aesthetic

Use a “technical field note” direction: near-black surfaces, warm white type, restrained signal gold, cool blue for system state, hairline rules, and sparse data annotations. The current 3D/video work remains the atmospheric anchor, but proof and hierarchy—not decorative card volume—carry the layout.

### Typography

- Self-host an open-licensed Archivo variable family so rendering is dependable and no third-party font request is required.
- Use condensed/strong display settings for headings and normal-width settings for body copy.
- Replace synthesized weights such as 650, 760, 820, and 950 with real supported values.
- Use tabular numerals and modest tracking for operational labels and metrics.

### Layout and components

- Make the header a real brand lockup: mark plus “Oliver Hitchings,” with a visible enquiry action.
- Use one strong visual anchor per section.
- Replace unnecessary rounded cards with ruled rows, split layouts, and process traces.
- Establish semantic tokens for colour, spacing, type, radii, borders, and motion.
- Add a considered tablet layout rather than collapsing every grid directly at 860 px.
- Keep controls at least 44 px high and provide visible keyboard focus.
- Move inline behavioural scripts into CSP-compatible modules and keep content/data separate from interaction code.

### Motion and media

- One hero video may load immediately; every below-fold video uses a poster, `preload="none"`, deferred source loading, and pause/resume based on viewport visibility.
- Remove or replace redundant video use where a CSS system trace communicates the idea more clearly.
- Re-encode retained media to modern WebM plus efficient MP4 fallback and generate still posters.
- Target no more than 8 MiB for all retained video variants commonly downloaded and no more than roughly 2.5 MiB in the initial desktop path.
- Normal motion is short and purposeful (about 180–320 ms and 8–16 px). `prefers-reduced-motion: reduce` removes reveal movement and stops autoplay rather than substituting another long animation.

## 5. Enquiry architecture

### Two independently releasable increments

1. **Urgent correctness release.** Fix the browser state machine, deploy it without changing the Worker contract, send one labelled production test, and confirm both provider acceptance and inbox receipt. This makes failure visible immediately and is not blocked by the redesign.
2. **Hardening and redesign release.** Add Turnstile, best-effort rate limiting, privacy-safe observability, the visual redesign, media work, SEO, accessibility, and security headers. Deploy the token-producing frontend before enforcing tokens in the production Worker.

### Canonical backend

The Cloudflare Worker remains the only contact backend. Remove the unused Pages/Resend implementation and document the Worker route and deployment in the README.

### Request flow

1. Accept only same-origin `POST`; no cross-origin use case or CORS preflight is required.
2. Reject a body above 16 KiB or unreadable content before expensive work.
3. Preserve the existing honeypot's silent-success behaviour.
4. Validate and normalize every field: name up to 120 characters; email up to 254; contact number up to 40; package from an explicit allowlist; automation request up to 4,000; tools up to 2,000; Turnstile token up to 2,048. Strip CR/LF from single-line values.
5. Apply a Cloudflare Worker rate-limit binding at five meaningful submissions per 60 seconds for the request source. This is best-effort, permissive, eventually consistent, and local to a Cloudflare location. IP-only keys can group legitimate users, but a five-per-minute contact-form threshold is intentionally generous; document that trade-off. Return `429` with `Retry-After: 60`.
6. Require a Cloudflare Turnstile token and validate it server-side through Siteverify. Confirm the `contact` action and an allowed production hostname. Fail closed if validation cannot be completed.
7. Send one email through the existing Cloudflare email binding. Set `replyTo` to the visitor's validated address so Oliver can reply normally.
8. Return stable JSON: success is `200 { ok: true, requestId }`; errors are `{ ok: false, code, message, requestId }` with `400`, `413`, `429`, `502`, or `503` as appropriate. Do not expose provider errors or secrets.

The Turnstile site key is public and supplied to the static build. The Turnstile secret is stored only as a Worker secret. Official test keys are used locally and in automated tests. No acknowledgement email is sent to the visitor, avoiding an additional spam relay surface.

### Observability and privacy

- Emit structured events for accepted, validation-rejected, Turnstile-rejected, rate-limited, delivered, and provider-failed requests.
- Include a request ID, Cloudflare Ray ID, status, and coarse country where available.
- Do not log enquiry text, names, email addresses, phone numbers, raw Turnstile tokens, or secrets.
- Record the Cloudflare email provider message ID only on successful delivery.
- Enable Worker logs/traces at 100% sampling while this low-volume form is in canary, using account-managed retention. Monitor 429 and 5xx in Workers Logs; Rate Limiting bindings are not exposed as a normal dashboard metric.
- Set the API's own no-store, content-type, and defensive response headers; Pages `_headers` rules do not apply to Worker responses.

### Browser behaviour

- The submit button remains disabled only while the request is in flight.
- Status is exposed through `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
- Success is shown only after an `ok` response; then the form resets.
- The Turnstile widget resets after every server attempt—success or failure—because tokens are single-use and expire after five minutes. Form fields reset only after confirmed success.
- Server-reported validation, rate-limit, Turnstile, or provider errors preserve the form and show a useful retry message.
- Client timeout or network loss is a distinct `delivery_unknown` state: “We could not confirm delivery. Your enquiry may have been sent; keep this page open and check before retrying.” A lost response does not prove the Worker stopped before sending, so it must not be labelled as definite failure.
- The site never automatically opens an email application. Primary contact links go to the on-site form.
- Use a bounded client timeout and prevent duplicate submissions.

## 6. SEO, accessibility, and security

### SEO and delivery

- Add a real `public/robots.txt` that permits indexing and points to `sitemap-index.xml`.
- Add a top-level Astro 404 page so Cloudflare Pages returns a real 404 instead of SPA fallback.
- Redirect `/sitemap.xml` to `/sitemap-index.xml`.
- Add a 1200×630 social preview image, `og:image`, Twitter large-card metadata, and verified Person/ProfessionalService JSON-LD.
- Make availability and price notes date-agnostic.
- Keep canonical URLs on the apex `.com` domain and prevent Pages preview domains from indexing.

### Accessibility

- Add a skip link, semantic landmarks, reliable heading order, visible focus states, and 44 px targets.
- Correct low-contrast footer text and ensure form errors are announced.
- Keep meaningful text outside video and provide poster/alternative context for decorative media.
- Respect reduced motion and data-saving preferences.

### Response security

Add a Pages `_headers` file with `Strict-Transport-Security: max-age=31536000` (without `includeSubDomains` or preload), `X-Frame-Options`, `Permissions-Policy`, and a stricter referrer policy. Introduce the Astro/Turnstile/Web Analytics policy as `Content-Security-Policy-Report-Only`, verify it in preview and a production canary, then enforce it in a separate reviewed change with a documented header rollback.

## 7. Testing and verification

Implementation follows test-driven development.

- Add Vitest with a browser-like DOM environment for the form controller.
- Test that the form waits for the response, clears only on success, preserves values on failure, resets Turnstile after every attempt, announces status, restores the button, handles malformed JSON, prevents duplicates, and distinguishes timeout/network `delivery_unknown` from definite server errors.
- Test the Worker with real `Request` objects and small boundary adapters for email, Turnstile, and rate-limit bindings.
- Cover wrong methods, bad JSON, the 16 KiB body boundary, every per-field boundary, package allowlisting, honeypot, header injection, Turnstile success/expired/duplicate/timeout, widget script or CSP failure recovery, best-effort rate limiting with `Retry-After`, email provider acceptance with `replyTo`, and provider failure.
- Build the static site and validate generated `robots.txt`, `404.html`, sitemap redirect, metadata, and headers files.
- Review each npm advisory, apply non-breaking security upgrades where available, and record any advisory that cannot be removed safely in this change.
- Run browser QA at 390×844, 768×1024, 1024×768, and 1440×900; cover keyboard navigation, WCAG 2.2 AA automated checks plus manual focus/contrast review, reduced motion, video deferral, all form states, and console/network errors.
- Compare media weight and a Lighthouse/Core Web Vitals baseline before and after.
- Validate the feature branch locally and in a non-production preview, then merge through the existing GitHub workflow. Production deployment remains tied to `main`.
- Send one clearly labelled production test enquiry, confirm the Worker returned success, and verify receipt in Oliver's inbox without opening an email client.

## 8. Deployment and secret handoff

- Extend CI so the site test/build gates run on pull requests and the production Pages deployment remains tied to `main`.
- Pin a current Wrangler version that supports the Rate Limiting binding rather than relying on an implicit latest CLI.
- Add a separate Worker deployment step using the existing Cloudflare account secret names. On `main`, deploy Pages first and the Worker second: the new form token is harmless to the old Worker, while deploying the enforcing Worker first would temporarily reject the old form.
- Create a production Turnstile widget restricted to `oliverhitchings.com` and `www.oliverhitchings.com`.
- At the one-time Turnstile secret reveal, pause for secure storage through Cloudflare/Wrangler or GitHub secrets; never place it in chat, source, logs, or documentation.
- Provision the production Turnstile widget, Worker secret, rate-limit binding, and a separate staging Worker before enforcement.
- Connect a Pages preview to the staging contact route and verify the full flow with official test keys.
- Production sequence: deploy the backward-compatible token-producing Pages frontend; verify it; deploy the enforcing Worker; confirm provider `messageId`; confirm actual inbox receipt; only then remove the unused Pages/Resend backend. Keep the previous Worker version and Pages deployment available for rollback.
- After deployment, inspect Worker logs, email logs, Turnstile analytics, route ownership, and the live form.

## 9. Non-goals

- No fabricated testimonials, client logos, revenue claims, time-saved claims, or outcome metrics.
- No CMS, account system, payment flow, visitor database, visitor acknowledgement email, or marketing automation.
- No migration away from Cloudflare Pages/Workers during this work.
- No `.co.uk` registration or redirect; the confirmed canonical domain is `.com`.

## 10. Acceptance criteria

The work is complete when:

- A valid live form submission sends directly to Oliver's configured inbox and does not open a mail application.
- Failure cannot be presented as success and entered data is not lost on failure.
- Spam controls are validated server-side and production secrets are absent from the repository.
- The Worker is the only contact implementation and has repeatable deployment plus useful privacy-safe logs.
- The first screen clearly identifies Oliver Hitchings and the service.
- Proof content uses only documented facts and transparent system examples; any “40+” claim has a named inventory or is removed.
- The site has a real 404, valid robots file, correct sitemap behaviour, social metadata, and baseline security headers.
- Keyboard, mobile, reduced-motion, status-announcement, and WCAG 2.2 AA checks pass at the named viewports.
- All retained commonly downloaded video variants total no more than 8 MiB, the initial desktop media path is no more than 2.5 MiB, and below-fold video makes no media request before approaching the viewport.
- API schemas, numeric body/field limits, allowlists, log-redaction assertions, and 100% canary sampling are verified.
- Automated tests, Astro build, browser QA, provider acceptance (`messageId`), and one separately confirmed production inbox receipt all pass.
