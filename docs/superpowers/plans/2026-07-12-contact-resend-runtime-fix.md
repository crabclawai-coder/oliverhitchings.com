# Contact Resend Runtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the production contact Worker reach Resend from Cloudflare's runtime and keep the form's final delivery status visible after Turnstile refreshes.

**Architecture:** Keep the direct Resend REST boundary and one-use Turnstile flow. Use a manual redirect policy that avoids the reproduced Workerd failure without following a redirect with private authorisation, preserve delivery status through widget refreshes, and reuse a stable browser submission UUID so ambiguous retries are idempotent.

**Tech Stack:** Cloudflare Workers/Workerd, Resend REST API, Turnstile, Vitest, Astro, Wrangler.

## Global Constraints

- Never expose, log, print, persist, or commit the Resend key, Turnstile secret, Cloudflare token, or owner destination.
- Keep Resend authorisation private and never follow a provider redirect with the authorisation header.
- Keep Turnstile in required/enforced mode and retain the existing one-use token reset.
- Preserve all entered form details on failed delivery.
- Do not touch or stage unrelated files in the user's other dirty checkout.
- Release only through the protected GitHub workflow and retain the current rollback version until the live send is verified.

---

### Task 1: Use a Workerd-compatible, credential-safe Resend redirect policy

**Files:**
- Modify: `contact-worker/src/index.test.js`
- Modify: `contact-worker/src/index.js`

**Interfaces:**
- Consumes: `sendWithResend({ apiKey, submissionId, email })` and its private `fetch()` request.
- Produces: a Resend request with `redirect: "manual"`; every non-2xx response, including a 3xx, remains a privacy-safe `provider_non_2xx` failure.

- [x] **Step 1: Write the failing request-contract test**

In the existing `posts the exact enquiry to Resend with private authentication and idempotency` test, change the expected request option to:

```js
redirect: "manual",
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- contact-worker/src/index.test.js -t "posts the exact enquiry to Resend"
```

Expected: FAIL because production still sends `redirect: "error"`.

- [x] **Step 3: Apply the smallest production fix**

In `sendWithResend`, change only the redirect mode:

```js
redirect: "manual",
```

Do not remove redirect control or use `follow`.

- [x] **Step 4: Verify GREEN and the delivery-boundary regression suite**

Run:

```bash
npm test -- contact-worker/src/index.test.js -t "posts the exact enquiry to Resend"
npm test -- contact-worker/src/index.test.js
```

Expected: the focused test and the full Worker test file pass with zero failures.

- [x] **Step 5: Commit the focused change**

```bash
git add contact-worker/src/index.js contact-worker/src/index.test.js docs/superpowers/plans/2026-07-12-contact-resend-runtime-fix.md
git commit -m "fix: make Resend delivery compatible with Workers"
```

Expected: one focused commit with no secret values.

---

### Task 2: Preserve the final form outcome while Turnstile refreshes

**Files:**
- Modify: `src/scripts/turnstile.test.js`
- Modify: `src/scripts/turnstile.js`

**Interfaces:**
- Consumes: `createTurnstileAdapter(...).reset()` after every attempted server request.
- Produces: a refreshed token or failure state without overwriting the contact controller's success/error copy; a later blocked submission still announces the current security recovery message.

- [x] **Step 1: Add the failing silent-refresh test**

Add this test inside `describe("createTurnstileAdapter", ...)`:

```js
it("refreshes a submitted token without overwriting the form outcome", async () => {
  const { adapter, api, announce } = createAdapter();
  await adapter.ready;
  const options = api.render.mock.calls[0][1];

  options.callback("submitted-token");
  announce.mockClear();

  adapter.reset();
  options.callback("refreshed-token");

  expect(adapter.getSubmissionDecision()).toMatchObject({
    allowed: true,
    state: "ready",
    token: "refreshed-token",
  });
  expect(announce).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Add the failing blocked-retry accessibility test**

```js
it("announces a suppressed reset failure when the user retries", async () => {
  const { adapter, api, announce } = createAdapter();
  await adapter.ready;
  const options = api.render.mock.calls[0][1];

  options.callback("submitted-token");
  announce.mockClear();

  adapter.reset();
  options["error-callback"]();
  expect(announce).not.toHaveBeenCalled();

  expect(adapter.prepareSubmission()).toMatchObject({
    allowed: false,
    state: "error",
    token: "",
  });
  expect(announce.mock.calls.at(-1)[0]).toMatch(/could not load/i);
});
```

- [x] **Step 3: Run both new tests and verify RED**

Run:

```bash
npm test -- src/scripts/turnstile.test.js -t "refreshes a submitted token|announces a suppressed reset failure"
```

Expected: both tests fail because reset callbacks currently announce immediately.

- [x] **Step 4: Implement silent post-submission refreshes**

In `createTurnstileAdapter`, add:

```js
let suppressStatusAnnouncements = false;

const announceUnlessSuppressed = (message) => {
  if (!suppressStatusAnnouncements) {
    announce(message);
  }
};
```

Use `announceUnlessSuppressed` in `setState` and the successful token callback. In `getSubmissionDecision`, clear suppression and call `announce(stateMessage)` when a required-mode submission is blocked. In `reset()`, set `suppressStatusAnnouncements = true` before clearing the token and resetting the provider widget.

- [x] **Step 5: Verify GREEN and both form suites**

Run:

```bash
npm test -- src/scripts/turnstile.test.js -t "refreshes a submitted token|announces a suppressed reset failure"
npm test -- src/scripts/turnstile.test.js src/scripts/contact-form.test.js
```

Expected: both new tests and both complete form-related test files pass with zero failures.

- [x] **Step 6: Commit the focused change**

```bash
git add src/scripts/turnstile.js src/scripts/turnstile.test.js
git commit -m "fix: preserve contact form delivery status"
```

Expected: a second focused commit with no unrelated files.

---

### Task 3: Verify the complete release candidate

**Files:**
- No production-file changes expected.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a locally verified branch ready for the protected GitHub release workflow.

- [x] **Step 1: Run the complete release gate**

```bash
node scripts/verify-contact-release-config.mjs
npm audit --audit-level=moderate
npm test
npm run check:media
npm run build
worker_out="$(mktemp -d)"
npx wrangler deploy --dry-run --strict --outdir "$worker_out" --config contact-worker/wrangler.toml
git diff --check origin/main...HEAD
```

Expected: the release verifier, audit threshold, 268-or-more tests, media checks, static build, strict Worker dry-run, and whitespace check all pass. The build must not create `dist/_worker.js` or `dist/_routes.json`.

- [x] **Step 2: Inspect the final branch scope**

```bash
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only the plan, Resend redirect regression, Turnstile lifecycle recovery, idempotent retry, and directly related operations-documentation changes are present; the worktree is clean.

---

### Task 4: Make ambiguous delivery retries idempotent

**Files:**
- Modify: `src/scripts/contact-form.js`
- Modify: `src/scripts/contact-form.test.js`
- Modify: `contact-worker/src/index.js`
- Modify: `contact-worker/src/index.test.js`

**Interfaces:**
- Consumes: one browser-generated UUID for each unchanged enquiry and Resend's idempotency-key contract.
- Produces: identical provider requests when a visitor retries an unchanged enquiry after a lost or timed-out response; edited enquiries receive a fresh identity.

- [x] **Step 1: Prove the duplicate-delivery risk with failing tests**

Add browser tests showing unchanged retries reuse a submission ID and edited enquiries do not. Add Worker tests showing provider timeout, network, malformed-success, and missing-ID outcomes are reported as delivery unknown, plus an end-to-end retry test requiring identical Resend idempotency keys and bodies.

- [x] **Step 2: Add a stable per-enquiry submission identity**

Generate a UUID immediately before the first allowed request. Reuse it while the normalised form fields are unchanged, clear it after confirmed success, and include it only in the private JSON request to the Worker.

- [x] **Step 3: Make Resend retries byte-for-byte stable**

Validate the optional UUID at the Worker boundary, use it for `Idempotency-Key`, and replace request-specific email timestamp/ID lines with the stable submission ID. Preserve a request-specific internal ID for Turnstile and privacy-safe logs.

- [x] **Step 4: Distinguish definite failure from unknown delivery**

Return and log an explicit delivery-unknown result for provider timeout, network loss, malformed 2xx bodies, and missing message IDs. Keep missing configuration and non-2xx provider rejection as definite failures.

- [x] **Step 5: Run the complete release gate again**

Run the focused browser and Worker suites, then the full tests, media checks, static build, strict Worker dry-run, audit threshold, and whitespace checks before committing and shipping.
