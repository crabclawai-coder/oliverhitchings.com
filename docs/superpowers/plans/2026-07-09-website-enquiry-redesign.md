# Website enquiry repair and redesign implementation plan

> **For Codex:** Execute this plan test-first. Keep the urgent correctness release independently deployable. Do not enforce Turnstile in production until the token-producing frontend is verified live.

> **Implementation pivot — 10 July 2026:** The implemented contact path sends through Resend using the isolated `forms.oliverhitchings.com` sender subdomain. The legacy Pages Function remains temporarily as a production fallback until provider acceptance, delivery, inbox, reply-to, and rollback checks have passed. The dedicated production Worker is now gated on required/enforced Turnstile rather than an unprotected delivery-proof interval. Any Cloudflare Email Service, disabled-production-control, or immediate Pages Function deletion steps below preserve the original plan and are superseded by the [contact form operations runbook](../../operations/contact-form.md).

**Goal:** Make `oliverhitchings.com` send enquiries directly and honestly, then ship a protected Cloudflare backend and a clearer, faster, founder-led redesign.

**Architecture:** Astro continues to build a static Cloudflare Pages site. Browser behaviour moves into small ES modules with Vitest/jsdom coverage. A single Cloudflare Worker owns `/api/contact`, sends through an onboarded Cloudflare Email Service binding, and later adds Turnstile, best-effort rate limiting, and privacy-safe logs. Pages deploys before the enforcing Worker so the public form never becomes incompatible with production.

**Tech stack:** Astro 6, JavaScript ES modules, Vitest 4.1.10, jsdom 29.1.1, Cloudflare Pages, Workers, Email Service, Turnstile, Workers Rate Limiting API, Wrangler 4.110.0, GitHub Actions, ffmpeg.

---

## Release A — urgent correctness and delivery

### Task 1: Add the browser test harness

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.js`
- Create: `src/scripts/contact-form.js`
- Create: `src/scripts/contact-form.test.js`

**Step 1: Install the pinned development dependencies**

Run:

```bash
npm install --save-dev vitest@4.1.10 jsdom@29.1.1 @vitest/coverage-v8@4.1.10 wrangler@4.110.0
```

Expected: lockfile updates; no production dependency is added.

**Step 2: Add test scripts and jsdom configuration**

Add `test`, `test:watch`, and `test:coverage` scripts. Configure Vitest to include `src/**/*.test.js` and `contact-worker/**/*.test.js`, default to the Node environment, and opt the contact form test into jsdom.

**Step 3: Write a failing smoke test**

Import `createContactFormController` from `src/scripts/contact-form.js`, build a minimal form/status DOM, and assert the export is callable.

**Step 4: Run the focused test and confirm RED**

Run:

```bash
npm test -- src/scripts/contact-form.test.js
```

Expected: FAIL because `src/scripts/contact-form.js` does not exist.

**Step 5: Add the smallest export and confirm GREEN**

Create `src/scripts/contact-form.js` with a callable `createContactFormController` export and no behaviour beyond what the smoke test requires.

Run:

```bash
npm test -- src/scripts/contact-form.test.js
```

Expected: PASS.

**Step 6: Commit the green harness**

```bash
git add package.json package-lock.json vitest.config.js src/scripts/contact-form.js src/scripts/contact-form.test.js
git commit -m "test: add contact form harness"
```

### Task 2: Implement an honest contact-form state machine

**Files:**

- Create: `src/scripts/contact-form.js`
- Modify: `src/scripts/contact-form.test.js`
- Modify: `src/pages/services.astro`

**Step 1: Add failing behaviour tests**

Cover, one assertion group at a time:

- initial explanatory status;
- button text/disabled state while pending;
- no reset before a response;
- `200 {ok:true}` resets the form and shows confirmed success;
- `400/413/429/502/503` preserve values and display the server message;
- malformed/non-JSON error responses use a stable fallback;
- thrown `TypeError` or `AbortError` preserves values and shows `delivery_unknown` wording;
- a second submit while pending does not create another request;
- button and `aria-busy` restore in `finally`;
- honeypot silently exits without a request;
- status text is set through `textContent`, never provider HTML.

**Step 2: Run tests and confirm RED**

```bash
npm test -- src/scripts/contact-form.test.js
```

Expected: the new behavioural assertions fail.

**Step 3: Implement the smallest controller**

Implement `createContactFormController({ form, status, fetchImpl, timeoutMs, turnstile })` and `initContactForms()`. Use an `AbortController`, a 12-second timeout, stable public messages, and an in-flight guard. Treat network loss as delivery unknown because the Worker may already have sent.

**Step 4: Wire the Astro form**

- Add `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
- Add a stable status message element ID and `aria-describedby`.
- Import and initialize the module from an Astro module script.
- Remove the inline handler that calls `showSubmitted()` before `fetch` resolves.

**Step 5: Run focused tests and build**

```bash
npm test -- src/scripts/contact-form.test.js
npm run build
```

Expected: PASS; Astro emits the services page without an inline contact handler.

**Step 6: Commit**

```bash
git add src/scripts/contact-form.js src/scripts/contact-form.test.js src/pages/services.astro
git commit -m "fix: report enquiry delivery honestly"
```

### Task 3: Characterize and improve the current Worker contract

**Files:**

- Create: `contact-worker/src/index.test.js`
- Modify: `contact-worker/src/index.js`
- Modify: `contact-worker/wrangler.toml`

**Step 1: Write failing Worker contract tests with real `Request` objects**

Use small boundary fakes only for `CONTACT_EMAIL.send`. Cover:

- non-POST returns `405`;
- malformed JSON returns `400`;
- body over 16 KiB returns `413` without reading/sending;
- honeypot returns silent `200` without sending;
- required-field validation;
- package allowlist;
- per-field length limits and CR/LF stripping;
- successful send uses the fixed destination, verified sender, and visitor `replyTo`;
- success returns `{ok:true, requestId}` and logs the provider `messageId` without PII;
- provider errors return stable `502` JSON and log `error.code` plus request/Ray IDs without payload data.

**Step 2: Run tests and confirm RED**

```bash
npm test -- contact-worker/src/index.test.js
```

Expected: failures for size limits, allowlist, schemas, `replyTo`, request ID, and redacted structured logs.

**Step 3: Refactor without changing the production route**

Export a testable `handleContactRequest(request, env, context)` and keep the default Worker's `fetch` delegate. Add constants for limits and packages. Return defensive API headers directly from the Worker. Do not add Turnstile or rate limiting in Release A.

**Step 4: Run tests**

```bash
npm test -- contact-worker/src/index.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add contact-worker/src/index.js contact-worker/src/index.test.js contact-worker/wrangler.toml
git commit -m "fix: harden contact worker responses"
```

### Task 4: Confirm the email provider root cause and onboard sending

**External configuration, no repository secrets.**

**Step 1: Capture the existing failure**

Tail `oliverhitchings-contact` and send a labelled test POST. Record the Cloudflare Ray ID, structured error code, status, and UTC time. Do not record form PII.

Expected: reproduce the current `502` and identify the provider code, likely sender-domain onboarding or recipient authorization.

**Step 2: Verify current DNS without changing root mail flow**

Confirm the root MX/SPF records remain with the current mail host. Email Sending must use Cloudflare's separate `cf-bounce` records; do not enable Email Routing or replace root MX.

**Step 3: Onboard `oliverhitchings.com` to Cloudflare Email Sending**

Review the proposed DNS changes before applying. Permit only `cf-bounce` MX/SPF/DKIM records and any compatible DMARC handling. Do not overwrite the root MX or create a second root SPF record.

**Step 4: Verify destination authorization**

Confirm the configured destination inbox is verified/allowed in the Cloudflare account. Do not reveal or copy credentials.

**Step 5: Run a provider-level test**

Use a remote email binding or the deployed Worker to send one message labelled `Website delivery test — no action required`. Require a provider `messageId`.

**Step 6: Confirm inbox receipt separately**

Use Cloudflare Email Logs for provider acceptance. Oliver confirms actual inbox receipt manually unless a separately approved mailbox connector is available.

### Task 5: Ship Release A without coupling it to redesign work

**Files:**

- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Step 1: Add CI gates without Worker enforcement**

Run tests and build on pull requests and `main`. Keep Pages production deployment on `main`. Add a manually gated Worker deploy command for Release A only after Email Sending verification.

**Step 2: Run the full local gate**

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

**Step 3: Browser-test the local services form**

Exercise success, server failure, timeout, duplicate submit, keyboard focus, and status announcement at mobile and desktop widths using controlled response interception.

**Step 4: Use the ship workflow**

Review the complete diff, commit intentional changes, push the branch, open the PR, land it, and wait for Pages deployment.

**Step 5: Verify production before changing the Worker**

Confirm the new form no longer displays false success against the still-compatible Worker.

**Step 6: Deploy the characterized Worker and send one live form enquiry**

Require HTTP 200, provider `messageId`, and separately confirmed inbox receipt. Roll back the Worker version immediately if sending regresses.

---

## Release B — protected backend and full redesign

### Task 6: Add Turnstile and best-effort rate limiting test-first

**Files:**

- Modify: `contact-worker/src/index.test.js`
- Modify: `contact-worker/src/index.js`
- Modify: `contact-worker/wrangler.toml`
- Modify: `src/scripts/contact-form.test.js`
- Modify: `src/scripts/contact-form.js`
- Modify: `src/pages/services.astro`

**Step 1: Add failing Worker tests**

Cover missing, invalid, expired, duplicate, wrong-action, wrong-hostname, and timed-out Siteverify results; Rate Limiting `success:false`; `Retry-After: 60`; and no email call unless both controls pass.

**Step 2: Add failing browser tests**

Cover widget ready/error/unsupported states, missing token, token inclusion, token reset after every server attempt, form preservation on Turnstile error, and accessible recovery when CSP blocks the widget script.

**Step 3: Confirm RED**

```bash
npm test -- contact-worker/src/index.test.js src/scripts/contact-form.test.js
```

**Step 4: Implement server validation**

Add a 3.5-second Siteverify timeout, action/hostname checks, `TURNSTILE_SECRET_KEY`, and redacted structured outcomes. Add `CONTACT_RATE_LIMITER` with a unique integer namespace, limit 5, period 60. Document locality/eventual-consistency limitations.

**Step 5: Implement explicit client rendering**

Use the public site key, action `contact`, dark/flexible mode, error/expired callbacks, and reset after any completed attempt. Keep official test keys outside production.

**Step 6: Run tests and build**

```bash
npm test
npm run build
```

**Step 7: Commit**

```bash
git add contact-worker src/scripts/contact-form.js src/scripts/contact-form.test.js src/pages/services.astro
git commit -m "feat: protect website enquiries"
```

### Task 7: Establish the redesigned visual system

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/styles/global.css`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/Header.astro`
- Modify: `src/components/Footer.astro`
- Modify: `src/data/site.js`

**Step 1: Add structural assertions before styling**

Create a small generated-output test that builds the site and asserts: visible `Oliver Hitchings` brand text, skip-link target, one page-level `h1`, primary on-site enquiry link, and no primary `mailto:` contact action.

**Step 2: Confirm RED against current output**

```bash
npm run build
npm test -- src/**/*.output.test.js
```

**Step 3: Install and self-host Archivo**

Add `@fontsource-variable/archivo@5.2.8`; import local variable font assets. Define semantic tokens for colour, spacing, typography, borders, radii, focus, and motion. Use only real supported weights.

**Step 4: Rebuild the global frame**

Add the brand lockup, skip link, 44 px controls, visible `:focus-visible`, responsive desktop/tablet/mobile navigation, stronger footer contrast, and date-agnostic site copy.

**Step 5: Replace blanket reveal behaviour**

Move behaviour into a module, use short selective reveals, and eliminate motion/autoplay under reduced motion.

**Step 6: Verify output and commit**

```bash
npm test
npm run build
git diff --check
```

```bash
git add package.json package-lock.json src
git commit -m "feat: establish founder-led visual system"
```

### Task 8: Restructure homepage and supporting pages

**Files:**

- Modify: `src/pages/index.astro`
- Modify: `src/pages/services.astro`
- Modify: `src/pages/about.astro`
- Modify: `src/pages/blog.astro`
- Modify: `src/pages/blog/[slug].astro`
- Modify: `src/styles/global.css`

**Step 1: Add failing content/output assertions**

Assert the homepage contains the brand, owned-loop stages, transparent system-pattern labels, verified handover facts, package links, and a direct form CTA. Assert no invented client/testimonial wording and no unverified “40+” claim unless an inventory fixture exists.

**Step 2: Confirm RED**

```bash
npm run build
npm test -- src/**/*.output.test.js
```

**Step 3: Implement the page hierarchy**

Build the branded hero, proof rail, operating trace, system patterns, package comparison, editorial operating principles, and focused CTA. Update Services, About, and Blog to the same ruled editorial system. Remove unnecessary card grids.

**Step 4: Verify responsive composition**

Inspect 390×844, 768×1024, 1024×768, and 1440×900. Correct overflow, reading order, touch targets, line length, and visual hierarchy.

**Step 5: Commit**

```bash
git add src/pages src/styles/global.css
git commit -m "feat: redesign automation consultancy pages"
```

### Task 9: Optimize and govern media

**Files:**

- Modify/delete: `public/videos/*`
- Create: `public/images/posters/*`
- Create: `src/scripts/media.js`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/services.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Create: `scripts/check-media-budget.mjs`
- Modify: `package.json`

**Step 1: Add a failing media budget script**

Assert retained common-download video variants total at most 8 MiB, hero critical media at most 2.5 MiB, every below-fold video has a poster and `preload="none"`, and no duplicate source is embedded twice on one page.

**Step 2: Confirm RED**

```bash
npm run check:media
```

Expected: current 21.8 MiB payload fails.

**Step 3: Re-encode and reduce**

Use ffmpeg to create efficient WebM and MP4 fallbacks at appropriate resolutions. Remove redundant video use and generate compressed posters from representative frames.

**Step 4: Add deferred playback**

Load below-fold sources near the viewport, pause when offscreen, avoid autoplay under reduced motion or Save-Data, and keep meaningful content outside video.

**Step 5: Verify budget and commit**

```bash
npm run check:media
npm run build
```

```bash
git add public src/scripts/media.js src/pages src/layouts package.json scripts/check-media-budget.mjs
git commit -m "perf: reduce and defer website media"
```

### Task 10: Repair SEO, 404s, metadata, and headers

**Files:**

- Create: `public/robots.txt`
- Create: `public/_headers`
- Modify: `public/_redirects`
- Create: `src/pages/404.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Create: `public/images/social/oliver-hitchings-og.jpg`
- Create/modify: `src/**/*.output.test.js`

**Step 1: Add failing generated-output tests**

Assert `dist/robots.txt`, top-level `dist/404.html`, `/sitemap.xml` redirect, absolute 1200×630 social image metadata, Twitter large card, canonical URL, and valid JSON-LD. Assert preview noindex is Cloudflare's verified default rather than custom duplication.

**Step 2: Confirm RED**

```bash
npm run build
npm test -- src/**/*.output.test.js
```

**Step 3: Implement SEO and 404 fixes**

Create the files and metadata. Use verified Person/ProfessionalService facts only.

**Step 4: Add safe headers**

Set HSTS to `max-age=31536000` without preload/subdomain scope, anti-framing, permissions policy, and stricter referrer policy. Add a CSP Report-Only policy compatible with self-hosted assets, Turnstile, and Cloudflare Web Analytics. Keep a one-file rollback.

**Step 5: Verify locally and commit**

```bash
npm test
npm run build
git diff --check
```

```bash
git add public src/pages/404.astro src/layouts/BaseLayout.astro src/**/*.output.test.js
git commit -m "fix: repair site discovery and response policy"
```

### Task 11: Consolidate backend and automate safe deployment

**Files:**

- Delete: `functions/api/contact.js`
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`
- Create: `docs/operations/contact-form.md`

**Step 1: Add CI assertions**

Fail if both `functions/api/contact.js` and `contact-worker/src/index.js` exist. Require tests, media budget, and Astro build before deployment.

**Step 2: Document the production sequence and rollback**

Document source of truth, bindings, secret names (never values), routes, status codes, log fields, DNS boundaries, provider-vs-inbox verification, Pages rollback, and Worker version rollback.

**Step 3: Create staging infrastructure**

Create a staging Worker with no apex/`www` route, official Turnstile test keys, simulated email binding, and a Pages preview connection. Verify the full flow there.

**Step 4: Configure production CI sequencing**

On `main`: tests → build → Pages deploy → live frontend smoke check → Worker deploy → contact health check. Do not delete the old Pages backend until the new production Worker has returned a message ID and the inbox receipt is confirmed.

**Step 5: Remove the duplicate backend and commit**

```bash
git add .github README.md docs package.json
git rm functions/api/contact.js
git commit -m "ci: make contact deployment repeatable"
```

### Task 12: Full verification, release, and canary

**Step 1: Run the complete local gate**

```bash
npm test
npm run test:coverage
npm run check:media
npm run build
git diff --check
npm audit
```

Expected: all project checks pass; every remaining npm advisory is documented with rationale.

**Step 2: Run browser QA**

At all four named viewports, test every page, nav, keyboard path, focus ring, WCAG 2.2 AA automated checks, manual contrast, reduced motion, Save-Data behaviour, 404, robots, sitemap redirect, Turnstile lifecycle, definite errors, delivery unknown, and success.

**Step 3: Review performance**

Compare initial transfer, total media, LCP, CLS, and console/network errors with the saved baseline. Do not overstate four-view production analytics.

**Step 4: Use the pre-landing review and ship workflows**

Review the diff, push a PR, wait for CI, merge, and monitor the ordered deployment.

**Step 5: Production acceptance**

Send one labelled enquiry. Require: UI confirmed only after HTTP 200; provider `messageId`; redacted structured log; inbox receipt; reply action targets the submitted address; no email application opens.

**Step 6: Canary**

For the first 48 hours, keep 100% privacy-safe Worker sampling and inspect 429/5xx, Turnstile validation, CSP report-only console output, Pages errors, and form success. Enforce CSP only after the report-only policy is clean and reviewed.
