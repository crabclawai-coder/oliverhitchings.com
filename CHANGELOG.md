# Changelog

All notable changes to the website are recorded here.

## [0.1.1.0] - 2026-07-12

### Changed

- Required Cloudflare Turnstile validation on the production enquiry Worker before a visitor's message can be sent.
- Kept server-side rate limiting disabled until its real Cloudflare binding can be provisioned and tested safely.
- Removed the older Cloudflare Pages email handler so preview hostnames cannot bypass the protected Worker.
- Preserved the unused legacy Worker email binding during the first Resend release so strict deployment can reconcile configuration without silently deleting remote state.
- Mirrored Cloudflare's dashboard-generated persisted-log settings exactly so strict deployment can proceed without overriding observability state.

### Added

- Added an automated release check that parses the production Worker settings and prevents an unprotected second contact backend from returning.

## [0.1.0.0] - 2026-07-12

### Added

- A direct website enquiry flow with honest pending, success, definite-failure, and delivery-unknown states, without opening the visitor's email application.
- A protected Cloudflare Worker delivery path using Resend, Turnstile, request limits, privacy-safe logs, fixed recipient configuration, and visitor Reply-To handling.
- A founder-led editorial redesign across the home, services, about, Field Notes, article, and error pages.
- Complete canonical, social, structured-data, robots, sitemap, security-header, and real 404 support.
- Automated tests for browser behaviour, generated output, both contact backends, media policy, and deployment contracts.

### Changed

- Reduced retained media from 22.9 MB to 6.7 MB, with responsive AV1/H.264 sources, a compressed poster, deferred loading, reduced-motion handling, and Save-Data support.
- Reworked packages, operating principles, navigation, responsive layouts, focus states, hover feedback, and enquiry copy for clearer scanning and accessibility.
- Made GitHub Actions deploy the exact verified Pages artifact and placed Worker deployment behind protected, manual provider, secret, rollback, Turnstile, and production-branch gates.
- Updated supported dependencies to clear all moderate and high audit findings; two documented low-severity development-server findings remain pending the next supported Astro major release.

### Fixed

- Removed false enquiry success before server confirmation and preserved form data whenever delivery is not confirmed.
- Prevented oversized chunked requests from being buffered beyond the 16 KiB Worker limit.
- Required provider message IDs before reporting success and rejected provider redirects, malformed responses, stale rollback targets, and incomplete production abuse controls.
- Removed personal delivery destinations from new backend source, public error copy, and deployable Pages Function artifacts.
