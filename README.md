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

`npm run start` rebuilds before serving `dist/`, so local production checks do not use stale output.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) verifies pull requests and `main`. A successful push to `main`, or an explicit manual run selected on `main`, deploys `dist/` to the `oliverhitchings` Cloudflare Pages project. Manual runs selected on another ref cannot deploy production.

The contact Worker does not deploy on a push. Its workflow job is deliberately dormant until the provider, secret, live Pages form, rollback version, repository arming variable, and protected-environment approval have all been confirmed. Follow the operations runbook rather than bypassing those gates.

## Contact form

The services form sends JSON to same-origin `POST /api/contact`. The intended production route is owned by the Worker in [`contact-worker/`](contact-worker/), which validates the request and sends one email through Resend:

- sender: `forms.oliverhitchings.com`, which must be verified in Resend before deployment;
- destination: the configured owner inbox;
- `Reply-To`: the visitor's validated email address.

The root domain's existing mail MX and SPF records are outside this flow and must not be replaced. The older Pages Function in [`functions/api/contact.js`](functions/api/contact.js) remains temporarily as a rollback boundary; it must not be removed until the dedicated Worker has passed provider acceptance, delivery, inbox, and reply-to checks in production.

See [`docs/operations/contact-form.md`](docs/operations/contact-form.md) for configuration, release, evidence, rollback, and eventual cleanup instructions.
