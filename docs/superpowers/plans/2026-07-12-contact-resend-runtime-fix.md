# Contact Resend Runtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production contact Worker reach Resend from Cloudflare's runtime and keep the form's final delivery status visible after Turnstile refreshes.

**Architecture:** Keep the existing direct Resend REST boundary and one-use Turnstile flow. Change only the outbound redirect mode from `error` to `manual`, which avoids the reproduced Workerd failure without forwarding the private authorisation header, then make post-submission widget refreshes silent until a blocked retry needs security guidance.

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
- Consumes: `sendWithResend({ apiKey, requestId, email })` and its existing private `fetch()` request.
- Produces: a Resend request with `redirect: "manual"`; every non-2xx response, including a 3xx, remains a privacy-safe `provider_non_2xx` failure.

- [ ] **Step 1: Write the failing request-contract test**

In the existing `posts the exact enquiry to Resend with private authentication and idempotency` test, change the expected request option to:

```js
redirect: "manual",
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- contact-worker/src/index.test.js -t "posts the exact enquiry to Resend"
```

Expected: FAIL because production still sends `redirect: "error"`.

- [ ] **Step 3: Apply the smallest production fix**

In `sendWithResend`, change only the redirect mode:

```js
redirect: "manual",
```

Do not remove redirect control or use `follow`.

- [ ] **Step 4: Verify GREEN and the delivery-boundary regression suite**

Run:

```bash
npm test -- contact-worker/src/index.test.js -t "posts the exact enquiry to Resend"
npm test -- contact-worker/src/index.test.js
```

Expected: the focused test and the full Worker test file pass with zero failures.

- [ ] **Step 5: Commit the focused change**

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

- [ ] **Step 1: Add the failing silent-refresh test**

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

- [ ] **Step 2: Add the failing blocked-retry accessibility test**

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

- [ ] **Step 3: Run both new tests and verify RED**

Run:

```bash
npm test -- src/scripts/turnstile.test.js -t "refreshes a submitted token|announces a suppressed reset failure"
```

Expected: both tests fail because reset callbacks currently announce immediately.

- [ ] **Step 4: Implement silent post-submission refreshes**

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

- [ ] **Step 5: Verify GREEN and both form suites**

Run:

```bash
npm test -- src/scripts/turnstile.test.js -t "refreshes a submitted token|announces a suppressed reset failure"
npm test -- src/scripts/turnstile.test.js src/scripts/contact-form.test.js
```

Expected: both new tests and both complete form-related test files pass with zero failures.

- [ ] **Step 6: Commit the focused change**

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

- [ ] **Step 1: Run the complete release gate**

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

- [ ] **Step 2: Inspect the final branch scope**

```bash
git status --short
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only the plan, Resend redirect regression, and Turnstile status-preservation changes are present; the worktree is clean.
