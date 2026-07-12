# Oliver Hitchings cinematic motion restoration and structural clean-up

Date: 12 July 2026

Status: Approved direction; written specification pending final review

Canonical site: `https://oliverhitchings.com`

Delivery boundary: local preview only. This work must not deploy to Cloudflare Pages, publish a Worker, change DNS, alter Resend, or modify any other production configuration without a separate explicit instruction from Oliver.

## 1. Objective

Restore the animated visual character that made the earlier website feel alive while preserving the current editorial redesign, content hierarchy, accessibility work, SEO, and fully verified enquiry path. Clean up the page structure where the current design becomes repetitive or obstructive, especially on mobile, without turning the site back into a wall of decorative cards or videos.

The result should feel like the current website gained its cinematic layer back, not like the July redesign was reverted.

## 2. Verified starting point

- The production site uses Astro and the current dark technical-field-note design.
- The current hero retains the original cinematic visual in responsive MP4 and WebM formats.
- Four non-hero films were deliberately removed by the July redesign and remain recoverable from Git history without external downloads:
  - `process.mp4`
  - `bento.mp4`
  - `feature-card.mp4`
  - `cta-footer.mp4`
- The former unoptimised non-hero files total about 14.4 MiB. They must not be restored unchanged.
- The enquiry form sends directly from the site through the isolated Cloudflare Worker, Turnstile, and Resend path.
- The labelled production enquiry is visible in the intended Gmail inbox. Opening Gmail's Reply composer targets the submitted sender address exactly. The unsent verification draft was discarded.
- Gmail has no filter, blocked-sender entry, forwarding rule, or POP setting removing website enquiries.
- The live contact Worker, Turnstile configuration, Resend configuration, destination, and form contract are outside this visual change.

## 3. Chosen approach

Use a curated cinematic restoration rather than either extreme:

- Do not reproduce every former video instance or the old page layouts.
- Do not reduce the restoration to four ordinary video boxes.
- Give each recovered film one clear narrative job, with selective reuse on another route only when it reinforces the same idea.
- Preserve one signature scroll-responsive sequence and make the other films quiet viewport-controlled loops.
- Keep reading-led pages restrained.

This approach restores the former personality while keeping the current site's hierarchy, performance discipline, and clearer conversion path.

## 4. Route and chapter structure

### Home

The chapter order remains:

1. Cinematic hero
2. Proof rail
3. Method and process
4. Example system patterns
5. Packages
6. Ownership principles
7. Final enquiry invitation
8. Shared footer

Changes:

- Keep the existing hero film, headline, operator trace, and calls to action.
- Clarify the proof rail as `1 workflow` and `3 handover assets`; the current bare `1 / 3` presentation can read like a missing second step.
- Insert the restored process film into the method chapter as the page's signature visual hinge.
- Add one restored bento film beside the three example-pattern rows. Do not repeat the same decoder behind every row.
- Place the restored feature film beside the ownership-principle rows so the late page does not become a continuous wall of text.
- Use the restored CTA film as the atmospheric layer of the final enquiry invitation while preserving readable copy and a separate shared footer.

### Services

The chapter order remains:

1. Services hero and working sequence
2. Method
3. Packages
4. Fit criteria
5. Handover
6. Contact form
7. Shared footer

Changes:

- Keep the current hero copy and sequence panel.
- Place a compact process-film companion in the method chapter. It loops rather than scroll-scrubs on this route.
- Reduce the vertical spacing through the middle chapters by approximately 15 percent, expressed through shared spacing tokens rather than route-specific magic numbers.
- Place the feature film in the handover chapter beside the ownership copy.
- Keep the contact chapter visually calm. No video may sit behind, overlap, or visually compete with the form, Turnstile, status message, or submit control.

### About

- Keep the current founder-led headline, operating stance, principles, and final call to action.
- Add the portrait feature film as the hero's human/visual anchor.
- Keep the existing factual panel as a compact caption or adjacent annotation rather than removing the facts.
- Do not add a second large film lower on the page.

### Field Notes

- Use the CTA film once as a restrained hero-side visual on the Field Notes index.
- Keep the note rows static apart from the current restrained hover and entry behaviour.
- Do not restore autoplaying video inside every article card.
- Keep individual articles reading-led and free of decorative video.

### 404, Now, and Pilot

- Keep the designed 404 restrained and functional.
- Preserve the intentional redirects for Now and Pilot.
- No recovered film is added to these routes.

## 5. Motion behaviour

### Signature process sequence

The homepage process film is the only scroll-responsive video.

- Enable scroll response only at desktop widths of 861 CSS pixels or wider.
- Enable it only when reduced motion is not requested and Save-Data is not active.
- Update the playhead only while the visual is intersecting the viewport.
- Schedule playhead changes in response to scroll events; do not restore the former permanent 60 fps animation loop.
- Map the chapter's viewport progress to the film duration with clamped start and end points.
- If metadata, seeking, or playback readiness fails, fall back to the normal viewport-controlled loop.

### Ambient films

The bento, feature, Services process, and CTA films use the existing media-loader principles:

- load sources only when the film is near the viewport;
- play only while visible;
- pause when off-screen or when the document is hidden;
- do not restart unnecessarily when revisited;
- use the poster only for reduced-motion and Save-Data visitors;
- retain a legible page if JavaScript, video decoding, or autoplay fails.

### Decorative status

All restored films are decorative:

- `aria-hidden="true"`;
- removed from the keyboard tab order;
- no alt-style prose that duplicates nearby content;
- every meaning, sequence, label, and call to action remains available in HTML text.

## 6. Media production and budgets

Recover the original source files from Git history and generate responsive derivatives.

### Landscape films

- AV1 WebM and H.264 MP4 at 1280 x 720.
- AV1 WebM and H.264 MP4 at 960 x 540.
- Silent, 24 fps, web-optimised, with MP4 fast-start metadata.

### Portrait films

- AV1 WebM and H.264 MP4 at approximately 720 x 960.
- AV1 WebM and H.264 MP4 at approximately 480 x 640.
- Silent, 24 fps, web-optimised, with MP4 fast-start metadata.

### Posters

- One WebP poster per film.
- Explicit intrinsic width and height.
- Target no more than 150 KiB per poster.

### Transfer budgets

- Preserve the current homepage initial media path: no more than 2.5 MiB on desktop and 1.75 MiB on mobile before scrolling.
- Target no more than 8 MiB of transferred video after deliberately scrolling through the complete homepage.
- Target no more than 4 MiB of transferred video after deliberately scrolling through the complete Services page.
- Target no more than 3 MiB of transferred video on About or Field Notes.
- A build-time media manifest must verify variants, dimensions, poster presence, and budgets. The existing guardrail must be expanded, not deleted or bypassed.

## 7. Reusable frontend structure

Create one reusable motion-film component with a small explicit contract:

- film identity;
- orientation;
- poster;
- responsive WebM and MP4 sources;
- loading mode;
- loop or scroll-responsive behaviour;
- optional visual caption supplied separately as real HTML.

Keep the scroll controller separate from the general media loader. The media loader remains responsible for source promotion, visibility, document state, reduced motion, and Save-Data. The scroll controller only maps viewport progress to the already-loaded homepage process film.

Do not couple animation code to the contact form, Turnstile, package selection, navigation state, or content data.

## 8. Structural clean-up

### Mobile navigation

At widths of 620 CSS pixels and below:

- Replace the current permanently expanded two-row fixed navigation with one compact row containing the brand, primary enquiry action, and a Menu control.
- The Menu control opens the four page links in a contained panel below the row.
- Use `aria-expanded` and an explicit controlled-panel relationship.
- Close the panel after a navigation choice, a second Menu activation, an outside pointer activation, or Escape.
- When Escape closes the panel, return focus to the Menu control.
- Preserve 44 x 44 CSS pixel minimum targets and a visible focus ring.
- Disable transition effects under reduced motion.
- The closed header must cover materially less content than the current mobile header.

Desktop and tablet navigation retain the current floating-pill composition.

### Section rhythm

- Use one shared editorial-heading grid for comparable Home and Services chapters.
- Keep larger gaps around major chapter changes and smaller gaps within a chapter.
- Tighten Services' repetitive middle sections by approximately 15 percent without reducing touch-target spacing or paragraph readability.
- Preserve a clear distinction between ruled editorial rows and interactive controls.

### Mobile typography

- Prevent the Home pattern heading from wrapping into the current seven-line block at 390 CSS pixels; target no more than five balanced lines without shrinking body copy below 16 CSS pixels.
- Preserve the existing high-impact display treatment in the hero.
- Avoid orphaned one-word final lines where a small measure or size adjustment resolves them.

### Content restraint

- Do not invent testimonials, results, client logos, or unsupported performance claims.
- Do not add new packages or change prices.
- Do not restructure the contact form fields.
- Copy changes are limited to structural labels, navigation text required by the compact menu, and corrections needed to keep headings legible.

## 9. Failure and fallback behaviour

- Missing or failed video sources leave the poster visible and preserve the section's dimensions.
- A failed scroll controller falls back to the standard loop when allowed, or the poster when motion/data preferences require it.
- A film may never block page rendering, navigation, text, or form interaction.
- Layout must reserve media dimensions before loading to prevent cumulative layout shift.
- No JavaScript error from media or navigation behaviour may prevent the contact-form scripts from initialising.

## 10. Verification

### Automated checks

- Component/output checks for every expected film, source, poster, intrinsic dimension, and decorative attribute.
- Media-loader tests for nearby loading, off-screen pause, visibility pause, reduced motion, Save-Data, and failed playback.
- Scroll-controller tests for viewport gating, progress clamping, inactive-state scheduling, fallback, and clean teardown.
- Mobile-menu tests for initial state, `aria-expanded`, opening, Escape, navigation close, focus behaviour, and reduced motion.
- Existing contact form, Turnstile, Worker, page-content, site-frame, build-output, SEO, and security tests remain green.
- Production delivery tests must not run from the local visual-preview workflow.

### Rendered QA

Inspect Home, Services, About, Field Notes, one article, and 404 at:

- 390 x 844;
- 768 x 1024;
- 1024 x 768;
- 1440 x 900.

Verify:

- no horizontal overflow;
- no text or controls obscured by the mobile header;
- intentional crops at every breakpoint;
- scroll response actually changes the homepage process playhead;
- ambient films start and pause at the correct viewport boundaries;
- posters are stable when motion or data saving is enabled;
- no cumulative layout shift from promoted media;
- no console errors;
- navigation, links, buttons, form fields, validation, and status regions remain usable;
- the pages still make sense when all video is prevented from loading.

### Local preview boundary

- Run the restoration on a local preview port, defaulting to 4321 when available.
- Do not submit a live enquiry during visual QA.
- Do not run a production deployment workflow.
- Do not push or merge the branch as part of preview creation.
- Leave production at `https://oliverhitchings.com` unchanged.

## 11. Acceptance criteria

The restoration is complete when:

1. All four recovered films have a deliberate placement without reverting the current page layouts.
2. The homepage has one working, viewport-scoped scroll-responsive process sequence.
3. Every other film uses safe nearby loading, off-screen pause, reduced-motion, Save-Data, and poster fallbacks.
4. The mobile header is compact when closed and fully keyboard accessible when opened.
5. The Home proof rail, Services rhythm, editorial-heading consistency, and mobile heading wraps are visibly cleaner.
6. The media budgets and complete automated suite pass.
7. Rendered desktop and mobile QA confirms that the site looks cohesive and all controls work.
8. The contact implementation and production configuration remain unchanged.
9. Oliver can inspect the complete result on a local port while the live website remains untouched.

## 12. Separate follow-on concept

After this restoration has been implemented and visually verified, create a separate from-scratch design exploration on another branch and local port. That concept may take larger visual and structural risks, but it must reuse truthful content and preserve a safe non-production enquiry experience. It is a separate design and implementation cycle, not an expansion of this specification.
