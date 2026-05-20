# oliverhitchings.com

Editable Astro site for `oliverhitchings.com`, prepared for local development and Cloudflare Pages deployment.

## Local development

```bash
npm install
npm run dev
```

The local server runs on `http://localhost:4321` by default.

## Production build

```bash
npm run build
npm run start
```

`npm run start` rebuilds before serving `dist/`, so local production checks do not use stale output.

## Live Deployment

The live site is deployed through GitHub Actions to Cloudflare Pages.

- Workflow: `.github/workflows/deploy.yml`
- Cloudflare Pages project: `oliverhitchings`
- Production domain: `https://oliverhitchings.com`

Pushes to `main` build the Astro site and deploy `dist/` to Cloudflare Pages.

## Contact Form

The services enquiry form posts to `/api/contact`. A dedicated Cloudflare Worker at `contact-worker/` owns that route and sends the enquiry using Cloudflare's email binding.
