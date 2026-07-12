# oliverhitchings.com

Astro source for `oliverhitchings.com`, deployed as a static Cloudflare Pages site with a dedicated Cloudflare Worker for enquiries.

## Local development

```bash
npm install
npm run dev
```

The local server runs on `http://localhost:4321` by default.

Run the same checks used by CI before opening a pull request:

```bash
npm ci
npm audit --audit-level=moderate
npm test
npm run check:media
npm run build
git diff --check
```

The media checks require `ffprobe`, which is included with `ffmpeg`; CI installs it explicitly.

`npm run start` rebuilds before serving `dist/`, so local production checks do not use stale output.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) verifies pull requests and `main`. A successful push to `main`, or an explicit manual run selected on `main`, deploys the exact verified static artifact to the `oliverhitchings` Cloudflare Pages project from a job with no source checkout. Manual runs selected on another ref cannot deploy production. A release check prevents a second Pages `/api/contact` backend from being reintroduced.

The contact Worker does not deploy on a push. Its workflow job is deliberately dormant until the provider, all delivery secrets, required/enforced Turnstile, the live Pages form, the active 100% rollback version, repository arming variable, typed confirmation, and protected-environment approval have all been confirmed. Follow the operations runbook rather than bypassing those gates.

## Contact form

The services form sends JSON to same-origin `POST /api/contact`. The intended production route is owned by the Worker in [`contact-worker/`](contact-worker/), which validates the request and sends one email through Resend:

- sender: `forms.oliverhitchings.com`, which must be verified in Resend before deployment;
- destination: the configured owner inbox;
- `Reply-To`: the visitor's validated email address.

The root domain's existing mail MX and SPF records are outside this flow and must not be replaced. The dedicated Worker is the only contact backend; Cloudflare Pages and its public preview hostname cannot send enquiries independently.

See [`docs/operations/contact-form.md`](docs/operations/contact-form.md) for configuration, release, evidence, rollback, and eventual cleanup instructions.

## Project records

- [`CHANGELOG.md`](CHANGELOG.md) records the user-facing release history.
- [`docs/superpowers/specs/2026-07-09-website-enquiry-redesign-design.md`](docs/superpowers/specs/2026-07-09-website-enquiry-redesign-design.md) records the approved design direction and implementation pivots.
- [`docs/superpowers/plans/2026-07-09-website-enquiry-redesign.md`](docs/superpowers/plans/2026-07-09-website-enquiry-redesign.md) records the staged implementation and verification plan.
