# Contact form operations

This runbook covers the enquiry form at `oliverhitchings.com`. It deliberately contains configuration names, but no secret values or DNS verification tokens.

## Source of truth and ownership

- The repository's `main` branch is the source of truth for the Astro site, the contact Worker, tests, and deployment workflow.
- `src/pages/services.astro` and `src/scripts/contact-form.js` own the browser form and its honest pending/success/failure states.
- `contact-worker/src/index.js` is the intended production backend for `/api/contact`; `contact-worker/wrangler.toml` declares its production routes and non-secret defaults.
- Cloudflare is the runtime source of truth for Pages deployments, Worker routes and versions, Worker secrets, bindings, logs, and DNS.
- Resend is the source of truth for sender-domain verification, provider message IDs, and delivery events.
- The repository and those two dashboards supersede older planning documents. Do not copy credentials or DNS verification values into the repository, tickets, logs, or this runbook.

Production is intentionally split into two independently reversible parts:

1. Cloudflare Pages serves the static site on `oliverhitchings.com` and `www.oliverhitchings.com`.
2. The `oliverhitchings-contact` Worker claims only the two configured contact routes:
   - `oliverhitchings.com/api/contact`
   - `www.oliverhitchings.com/api/contact`

The Worker has `workers_dev = false`; a `workers.dev` URL is not the production test target.

## Request and response contract

The browser submits same-origin JSON to `POST /api/contact`. It never opens a mail application. The request is limited to 16 KiB, and the Worker validates field types, required fields, allowed packages, field lengths, origin, and content type before contacting Resend.

Successful non-honeypot submissions return:

```json
{
  "ok": true,
  "requestId": "generated-request-id"
}
```

Errors use the stable shape:

```json
{
  "ok": false,
  "code": "stable_machine_code",
  "message": "safe message for the visitor",
  "requestId": "generated-request-id"
}
```

| HTTP status | `code` | Meaning |
| --- | --- | --- |
| `200` | — | Accepted by the Worker, or a silent honeypot response. For a real test, continue through the full proof ladder below. |
| `400` | `invalid_origin` | The `Origin` is not the request URL's origin. |
| `400` | `invalid_content_type` | The request is not JSON. |
| `400` | `invalid_json` | The request body cannot be read or parsed as JSON. |
| `400` | `invalid_submission` | Field types, required values, package, lengths, honeypot type, or token length are invalid. |
| `400` | `turnstile_required` | Turnstile enforcement is on and the token is missing. |
| `400` | `turnstile_rejected` | Turnstile enforcement is on and Siteverify rejected the token, action, hostname, or timestamp. |
| `405` | `method_not_allowed` | A method other than `POST`; the response includes `Allow: POST`. |
| `413` | `payload_too_large` | The body is larger than 16 KiB. |
| `429` | `rate_limited` | The configured rate limiter rejected the request in enforce mode; the response includes `Retry-After: 60`. |
| `502` | `email_send_failed` | Resend was not configured, timed out, could not be reached, rejected the request, or did not return a message ID. |
| `503` | `turnstile_unavailable` | Turnstile could not be verified while Worker enforcement is enabled, or its mode is invalid. |

Every Worker response is JSON with `Cache-Control: no-store`. A client timeout or lost connection is reported by the browser as delivery unknown because the Worker may have sent the message before the response was lost. Preserve the form values and check the provider logs before retrying.

## Configuration inventory

### GitHub Actions

Repository secret names used by the Pages job:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`CLOUDFLARE_API_TOKEN` is the Pages credential. Give it only the account-level Cloudflare Pages edit permission required by the existing deployment; never add Workers Scripts or Workers Routes permission to it.

The protected `contact-worker-production` GitHub Environment supplies a separate environment secret:

- `CLOUDFLARE_WORKER_API_TOKEN`

This Worker-only token needs the minimum account Workers Scripts and zone Workers Routes permissions required to inspect and deploy `oliverhitchings-contact`. It must not be stored as a repository secret or exposed to the automatic Pages job. The workflow injects it only into the three Wrangler steps after environment approval; checkout, setup actions, and `npm ci` do not receive it. Audit both token scopes before enabling the Worker gate; rotate either token if its authority is broader than described. `CLOUDFLARE_ACCOUNT_ID` contains no deployment authority and can remain the shared account identifier.

Public build variables used by the Pages build:

- `PUBLIC_TURNSTILE_MODE`
- `PUBLIC_TURNSTILE_SITE_KEY`

The site key is public by design. Never place the Turnstile secret or Resend API key in a `PUBLIC_` variable.

The dormant Worker release gate also checks the repository variable `CONTACT_WORKER_DEPLOY_ENABLED`. Leave it unset or set to anything other than `true` until all preconditions in this runbook are complete. Remove or disable it immediately after the intended release.

### Cloudflare Worker

Secret names, stored in Cloudflare for `oliverhitchings-contact`:

- `RESEND_API_KEY`
- `TURNSTILE_SECRET_KEY`

Non-secret variables:

- `TURNSTILE_MODE`
- `TURNSTILE_ALLOWED_HOSTNAMES`
- `RATE_LIMIT_MODE`

Optional binding:

- `CONTACT_RATE_LIMITER`

The checked-in Worker defaults both control modes to `off`, and the rate-limit binding is not yet declared. Do not set rate limiting to `observe` or `enforce` until the real binding has been provisioned, reviewed, and tested. Make Worker variable and binding changes in reviewed configuration rather than creating undocumented dashboard drift.

### Retained legacy Pages Function

`functions/api/contact.js` is still included in a Pages deployment. It may use these Pages environment names while it remains:

- `RESEND_API_KEY`
- `CONTACT_FROM_EMAIL`
- `CONTACT_TO_EMAIL`

This function is not the intended production backend. It is retained temporarily so deletion does not remove the only fallback before route ownership and end-to-end delivery have been proved.

## Resend sender-domain boundary

The dedicated Worker sends from `contact@forms.oliverhitchings.com` to the configured owner inbox and sets `reply_to` to the visitor's validated address.

Verify `forms.oliverhitchings.com` as its own sending subdomain in Resend. Review the exact DNS proposal in the Resend and Cloudflare dashboards before applying it, and add only the provider-supplied records below that subdomain (including any delegated bounce or DKIM names within it).

Do not:

- change or remove the apex `oliverhitchings.com` MX records;
- change, replace, or add a competing apex SPF record;
- enable an unrelated apex mail-routing product;
- move the sender to the apex merely to make verification easier;
- store a DNS verification token in source control.

The existing root mailbox service and the Resend sending subdomain are separate mail flows. Re-check the public apex MX and SPF records before and after any sender-domain work; there should be no apex mail change.

## Turnstile and rate-limit modes

The frontend and Worker use intentionally different names:

| Layer | Mode | Behaviour |
| --- | --- | --- |
| Frontend | `off` | Does not load Turnstile. |
| Frontend | `observe` | Loads the widget and sends a token when available, but allows an enquiry when the widget is unavailable. |
| Frontend | `required` | Requires a usable token before submitting. |
| Worker | `off` | Skips Siteverify. |
| Worker | `observe` | Calls Siteverify and logs the outcome, but does not reject missing, rejected, or unavailable checks. |
| Worker | `enforce` | Accepts only a valid token for action `contact` and an allowed production hostname. Missing/rejected tokens return `400`; verification outages return `503`. |
| Rate limiter | `off` | Does not call the binding. |
| Rate limiter | `observe` | Calls and logs the binding but never blocks a request. |
| Rate limiter | `enforce` | Returns `429` when the binding reports a limit. A missing/failing binding fails open and is logged as unavailable. |

An invalid Turnstile Worker mode fails closed with `503`; an invalid rate-limit mode logs a configuration error and fails open. Do not deploy Worker enforcement before the token-producing Pages frontend is live and tested.

## Privacy-safe observability

The Worker uses structured logs. Correlate records using `requestId` and `cfRay`.

| Event | Fields currently recorded |
| --- | --- |
| `contact_email_accepted` | `event`, `provider`, `requestId`, `cfRay`, `messageId` |
| `contact_email_failed` | `event`, `requestId`, `cfRay`, coarse internal `code` |
| `contact_turnstile` | `event`, `mode`, `requestId`, `cfRay`, `outcome`, `reason` |
| `contact_turnstile_configuration` | `event`, invalid `mode`, `requestId`, `cfRay`, `outcome`, `reason` |
| `contact_rate_limit` | `event`, `mode`, `requestId`, `cfRay`, `outcome` |
| `contact_rate_limit_configuration` | `event`, invalid `mode`, `requestId`, `cfRay`, `outcome` |

Do not log names, email addresses, telephone numbers, form text, Turnstile tokens, API keys, provider response bodies, raw IP addresses, or the rate-limit key. `CF-Connecting-IP` is used only as the in-memory input to the Cloudflare rate-limit binding and is not included in structured logs.

`contact_email_accepted` means Resend accepted the API request and returned an ID. It is not proof that the receiving mail server accepted the message or that the message appeared in the inbox.

## Required delivery proof

Use one clearly labelled, non-sensitive production test and record UTC timestamps. The test is complete only when every level is linked to the same request/message:

1. **Worker response:** `POST /api/contact` returns HTTP `200` with `{ "ok": true, "requestId": "..." }` for the real, non-honeypot submission.
2. **Provider acceptance:** Worker logs contain `contact_email_accepted` with the same `requestId` and a Resend `messageId`.
3. **Provider delivery:** Resend shows a `Delivered` event for that exact `messageId`. Acceptance alone is insufficient.
4. **Inbox receipt:** Oliver manually confirms the labelled message is visible in the destination inbox. No Gmail access or connector is required.
5. **Reply target:** Using a controlled test sender address, confirm the received message's Reply-To/reply action points to that submitted address, not the website sender.

Do not mark delivery fixed from an HTTP `200`, a message ID, or a provider `Delivered` event alone. Retain only the IDs, status, and timestamps needed for the release record; do not copy the test payload into logs or documentation.

## CI and release gate

The GitHub Actions workflow runs the following on pull requests, `main`, and manual dispatches:

```bash
npm ci
npm audit --audit-level=moderate
npm test
npm run check:media
npm run build
git diff --check
```

Pull requests stop after verification. A `main` push or manual dispatch selected on the `main` ref can deploy Pages only after the verification job passes. A manual run selected on any other ref cannot deploy production.

The contact Worker never deploys from a push. Its manual job remains skipped unless all of these are true:

1. The run is a manual `workflow_dispatch`.
2. The selected workflow ref is `main`.
3. Every provider, secret, Pages preflight, and protected-environment-readiness checkbox is explicitly selected. The Pages checkbox is preflight evidence only; the exact deployment from this run is tested while the Worker job waits for approval.
4. A non-empty existing Worker rollback version ID is supplied.
5. `DEPLOY CONTACT WORKER` is typed exactly.
6. The repository variable `CONTACT_WORKER_DEPLOY_ENABLED` is exactly `true`.
7. The `contact-worker-production` GitHub Environment grants its separate manual approval. Before arming the repository variable, configure required reviewers, prevent self-review, disable administrator bypass where the account permits, and set deployment branches/tags to selected branches with `main` as the only allowed branch and no tags.
8. The job validates the rollback version as a full lowercase UUID, confirms it exists in Cloudflare, and checks the returned ID is identical.
9. The job confirms that a secret named `RESEND_API_KEY` exists for the Worker without reading its value.
10. The Pages deployment in the same run has completed first.

Until the Resend domain is verified, the required secrets and least-privilege tokens are stored, the live Pages form is tested, and the rollback target is recorded, do not create the arming variable or approve the protected environment. The first production delivery proof happens immediately after this gated deployment; it is the completion gate, not a precondition that would make the release impossible. The workflow contains no automatic Worker deployment path.

Production runs share one non-cancelling workflow concurrency lock. A manual run waiting for the protected Worker approval therefore prevents a later `main` run from replacing the Pages deployment that was tested in the manual run. Approve or reject the waiting release promptly; reject it before starting a newer production release.

## Deployment order

Before a production release:

1. Make the full local and CI gate green.
2. Verify the Resend sending subdomain without changing apex MX or SPF.
3. Store `RESEND_API_KEY` as a Cloudflare Worker secret; never pass its value through a workflow input.
4. Record the current successful Pages deployment ID, current `main` commit, and current Worker version ID as rollback targets.
5. Configure the production Turnstile site key/secret only when staging Turnstile; keep both frontend and Worker modes `off` for the initial email-delivery proof.
6. Confirm the repository `CLOUDFLARE_API_TOKEN` remains Pages-only. Configure the protected `contact-worker-production` GitHub Environment with required reviewers, prevention of self-review, no administrator bypass where supported, a `main`-only deployment branch policy, no allowed tags, and its separate `CLOUDFLARE_WORKER_API_TOKEN`. Arm `CONTACT_WORKER_DEPLOY_ENABLED` only for the intended release window.

Release in this order:

1. Start the armed manual workflow on the `main` ref with every preflight input completed, but do not approve the protected environment yet.
2. Wait for that run's `deploy_pages` job to finish and for `deploy_contact_worker` to show that it is waiting for environment approval.
3. Test the exact live Pages deployment created by that run. Exercise the `/services/` form's pending, failure, timeout, keyboard, and responsive behaviour; confirm the deployed commit and Pages deployment ID match the release record.
4. Confirm the live page uses the intended frontend Turnstile mode and, when applicable, can produce a token.
5. Give the evidence to the independent environment reviewer. Only then should that reviewer approve `contact-worker-production`, allowing the Worker checks and deploy step to run.
6. Send one labelled live enquiry and complete the five-level proof ladder.
7. Inspect Worker logs, Resend events, Turnstile analytics when enabled, and route ownership.
8. Disable or remove `CONTACT_WORKER_DEPLOY_ENABLED` after the intended Worker release.

For a later Turnstile rollout, use the compatibility sequence: frontend `observe`, Worker `observe`, frontend `required`, then Worker `enforce`. Verify each step before advancing. Provision and observe the real rate-limit binding before rate enforcement.

## Rollback

Always record rollback identifiers before deploying.

### Pages rollback

If Pages fails before the Worker release, stop; do not approve the Worker job. In Cloudflare Pages, roll back to the recorded successful deployment. Alternatively, create and review a revert on `main`, then manually dispatch that new `main` state; the workflow will not deploy an arbitrary older or feature-branch ref as production. Re-test `/services/`, the form status behaviour, assets, CSP console output, and the API contract.

### Worker rollback

If the Worker or provider path regresses, leave the compatible Pages frontend in place and roll the Worker back to the recorded version:

```bash
npx wrangler rollback <recorded-version-id> \
  --config contact-worker/wrangler.toml \
  --yes
```

Confirm the command targets `oliverhitchings-contact` before accepting it. A version rollback may not undo separately changed secrets, DNS, bindings, or dashboard variables; restore those only from the reviewed pre-release record. Then send one controlled test and repeat the proof ladder.

Do not delete the Worker route as an improvised rollback. Route ownership changes can expose the retained Pages Function and must be planned and verified separately.

## CSP report-only period

`public/_headers` currently sends `Content-Security-Policy-Report-Only` for Pages content. It allows the documented Turnstile and Cloudflare Web Analytics origins but does not block a violating resource. There is no report collection endpoint in this repository, so inspect browser console violations during desktop and mobile QA and review Cloudflare behaviour before considering enforcement.

Pages `_headers` rules do not harden responses returned directly by the dedicated Worker; the Worker sets its own JSON, cache, content-type, and referrer headers.

## Retiring the duplicate backend

Keep `functions/api/contact.js` until all of the following are true:

- production apex and `www` route ownership is confirmed for the dedicated Worker;
- the full provider acceptance, delivery, inbox, and reply-to proof ladder has passed;
- the Pages and Worker rollback targets are recorded and tested;
- the dedicated Worker deployment path is repeatable;
- preview/staging behaviour has an explicit replacement rather than silently depending on the legacy function.

Then remove the Pages Function in its own reviewed change. In the same change, add a CI guard that fails if `functions/api/contact.js` or another second `/api/contact` handler appears, while asserting `contact-worker/src/index.js` remains the single backend source. Re-run the complete CI gate and production proof after deletion. Until that change lands, documentation must describe the Pages Function as retained, not dead or safely removable.
