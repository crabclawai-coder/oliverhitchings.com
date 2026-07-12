# Contact Production Turnstile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the checked-in production Worker enforce Cloudflare Turnstile while keeping the unprovisioned rate limiter disabled.

**Architecture:** The dedicated contact Worker remains the only intended production owner of the apex and `www` contact routes. Its reviewed Wrangler configuration becomes the source of truth for the non-secret control modes, and a repository test prevents the production security settings from drifting back to an unsafe value.

**Tech Stack:** Cloudflare Workers, Wrangler TOML, Vitest, GitHub Actions.

## Global Constraints

- Do not deploy the Worker from a local command; the TOML owns live apex and `www` routes.
- Keep `RATE_LIMIT_MODE = "off"` until a real rate-limit binding is provisioned and tested.
- Keep all secret values out of source, tests, logs, plans, and documentation.
- Do not touch or stage the untracked iCloud conflict copies whose names contain ` 2`.
- Production deployment remains behind the existing protected GitHub workflow and rollback checks.

---

### Task 1: Lock the production abuse-control modes

**Files:**
- Modify: `src/deploy-workflow.test.js`
- Modify: `contact-worker/wrangler.toml`
- Modify: `docs/operations/contact-form.md`

**Interfaces:**
- Consumes: the existing `contact-worker/wrangler.toml` `[vars]` keys and the manual workflow's exact `TURNSTILE_MODE = "enforce"` check.
- Produces: a tracked production configuration that enforces Turnstile, leaves rate limiting off, and is guarded by Vitest.

- [ ] **Step 1: Write the failing configuration-contract test**

Add the Worker configuration URL beside `workflowUrl`, then add this test to `src/deploy-workflow.test.js`:

```js
const workerConfigUrl = new URL(
  "../contact-worker/wrangler.toml",
  import.meta.url,
);

it("requires Turnstile while leaving the unprovisioned rate limiter off", async () => {
  const workerConfig = await readFile(workerConfigUrl, "utf8");

  expect(workerConfig).toMatch(/^TURNSTILE_MODE\s*=\s*"enforce"\s*$/m);
  expect(workerConfig).toMatch(/^RATE_LIMIT_MODE\s*=\s*"off"\s*$/m);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/deploy-workflow.test.js
```

Expected: the new test fails because the checked-in value is currently `TURNSTILE_MODE = "off"`.

- [ ] **Step 3: Apply the smallest production change**

In `contact-worker/wrangler.toml`, change only:

```toml
TURNSTILE_MODE = "enforce"
```

Keep:

```toml
RATE_LIMIT_MODE = "off"
```

Update the stale runbook sentence so it states that the checked-in production Worker enforces Turnstile and keeps rate limiting off until its binding is provisioned.

- [ ] **Step 4: Verify GREEN and the Worker bundle**

Run:

```bash
npm test -- src/deploy-workflow.test.js
npm test -- contact-worker/src/index.test.js src/deploy-workflow.test.js
worker_out="$(mktemp -d)"
npx wrangler deploy --dry-run --strict --outdir "$worker_out" --config contact-worker/wrangler.toml
git diff --check
```

Expected: both Vitest runs pass, Wrangler completes a dry run without uploading, and `git diff --check` prints no errors.

- [ ] **Step 5: Run the complete local gate**

Run:

```bash
npm audit --audit-level=moderate
npm test
npm run check:media
npm run build
```

Expected: the audit has no moderate-or-higher findings, all tests and media checks pass, and the production site builds successfully.

- [ ] **Step 6: Commit the focused change**

Stage only the three implementation files and this plan, then commit:

```bash
git add src/deploy-workflow.test.js contact-worker/wrangler.toml docs/operations/contact-form.md docs/superpowers/plans/2026-07-12-contact-production-turnstile.md
git commit -m "security: enforce Turnstile for contact Worker"
```

Expected: one focused commit containing no secret values or unrelated files.
