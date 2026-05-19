# oliverhitchings.com

Editable Astro site for `oliverhitchings.com`, prepared for local development and Railway deployment.

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

Railway can build this project with `npm run build` and serve it with `npm run start`.
Those commands are also pinned in `railway.json`.

## Railway and Cloudflare DNS

Railway project:

- Project: `oliverhitchings-com`
- Service: `oliverhitchings-com`
- Environment: `production`
- Temporary URL: `https://oliverhitchings-com-production.up.railway.app`
- Project URL: `https://railway.com/project/db6b1a44-d862-4f0e-9325-15d085df9096/service/ab9df495-5c88-4083-ad6d-0fccb354b4ad`

The custom domain `oliverhitchings.com` has been added in Railway and is waiting for DNS.

In Cloudflare DNS:

- Add a `CNAME` record:
  - Name: `@`
  - Value: `k0z64rgj.up.railway.app`
- Add a `TXT` record:
  - Name: `_railway-verify`
  - Value: `railway-verify=708a965092f969a2d12533a5716295eb6f384b4ca76575d14882a1f25f691edf`

Keep the existing live DNS records unchanged until you are ready for `oliverhitchings.com` to resolve to Railway. The current Railway plan only allows one custom domain, so `www.oliverhitchings.com` was not added.
