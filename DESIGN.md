# Design System — DCFLens

## Product Context

- **What this is:** Evidence-first equity research and deterministic discounted cash flow analysis.
- **Who it is for:** Investors and analysts who need assumptions, provenance, and valuation mechanics to remain inspectable.
- **Space:** Financial research and valuation software.
- **Project type:** Responsive editorial landing page leading into a future research application.

## Aesthetic Direction

- **Direction:** Editorial Research Terminal.
- **Decoration level:** Minimal.
- **Mood:** Institutional, calm, exact, and editorial. The interface should feel more like a carefully typeset research note than a generic dashboard.
- **Source of truth:** See `docs/design-direction.md` for detailed rules and license decisions.

## Typography

- **Display/Hero:** Clash Display, restricted to major editorial headings.
- **Body/UI:** Instrument Sans.
- **Data/Tables:** IBM Plex Mono with tabular figures.
- **Loading:** Instrument Sans and IBM Plex Mono are self-hosted through `next/font/local`. Clash Display uses Fontshare's authorized CSS service with optional display behavior because its ITF license restricts independent webfont transmission.
- **Fallbacks:** Display falls back to Instrument Sans, Avenir Next, Segoe UI, and sans-serif. Body falls back to Avenir Next, Segoe UI, and system UI. Data falls back to SFMono-Regular, Consolas, Liberation Mono, and monospace.
- **Scale:** 12, 14, 16, 18, 24, 32, 48, 72, and responsive 112px display sizes.

## Color

- **Approach:** Restrained neutrals with one controlled cobalt accent.
- **Accent:** `#2457d6`, reserved for links, focus, and primary action.
- **Neutrals:** paper `#f4f1e8`, raised paper `#fbfaf6`, ink `#171816`, muted `#62645d`, hairline `#d5d1c6`, strong line `#a8a398`.
- **Semantic:** supports `#1d6949`, weakens `#9a3e2f`, monitor `#8a6415`, unknown `#666963`, not applicable `#5b6170`.
- **Dark mode:** Not introduced in this phase; the visual identity is based on paper and ink.

## Spacing

- **Base unit:** 4px.
- **Density:** Spacious editorial sections with compact data rows.
- **Scale:** 4, 8, 12, 16, 24, 32, 48, 64, 96, and 128px.

## Layout

- **Approach:** Hybrid editorial grid with terminal-style ledgers.
- **Grid:** 12 columns desktop, 6 tablet, 1 mobile.
- **Max width:** 1280px.
- **Radius:** 2px controls, 4px exceptional grouped surfaces, no default card rounding.

## Motion

- **Approach:** Minimal-functional.
- **Duration:** 120ms micro, 180ms short, 240ms medium. These are the only durations; `src/lib/motion.ts` holds them as `MOTION.duration` and a test asserts they have not drifted.
- **Library:** GSAP with `@gsap/react` and ScrollTrigger. Registration happens once, in `src/components/motion/gsap.ts`; no component imports the packages directly.
- **What motion is for:** showing that one thing follows from another — a filed fact leading to a valuation, a citation leading to a conclusion. It never carries information of its own. A reader who never sees it loses nothing.
- **Reveals:** one-shot, triggered at `top 88%` so content is already well inside the viewport. `opacity` and a 10px `y` only, never `visibility` — a revealed element stays in the accessibility tree and stays focusable throughout. No scrub, no parallax, no scroll hijacking, no continuous or background animation.
- **Staggered groups:** the per-item delay compresses so any group, including the ten-point checklist, finishes inside a 240ms budget. Focus entering a group settles it immediately; motion never becomes a queue.
- **Financial figures are never counted up.** A figure tweened from zero prints values no filing supports. Figures render at their true value and only settle; a changed value cross-fades whole.
- **Disclosure panels never animate their height.** Growing from zero shrinks the document mid-tween, and a reader far enough down the page has their scroll position clamped and not restored. Panels take full size immediately, as they would with no JavaScript, and only their contents settle. Closing is not animated at all.
- **Reduced motion:** `prefers-reduced-motion: reduce` builds no tween at all — not a shorter one. Nothing is given a starting state, so there is nothing to revert and no path by which content can be left hidden.
- **Progressive enhancement:** every motion wrapper is `display: contents` and contributes no layout box. With scripting off, or if a motion component fails to load, the page renders and behaves exactly as it did before motion existed.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-08-29 | Created Editorial Research Terminal system | Matches evidence-first financial research and avoids generic dashboard conventions. |
| 2026-08-29 | Limited Clash Display to headlines | Preserves editorial distinctiveness without weakening data readability. |
| 2026-08-29 | Did not self-host Clash Display | Fontshare's ITF license restricts independent webfont transmission; authorized CSS delivery is used instead. |
| 2026-08-29 | Introduced GSAP, superseding "no GSAP, no entrance choreography" | The evidence-first argument is a chain — filed fact, checklist, adjustment, valuation — and the page had no way to show that one link follows from another. Motion states the order the page is already in; it does not add a claim. Constrained to the existing 120/180/240ms scale, one-shot reveals only, and no scroll hijacking. |
| 2026-08-29 | Figures settle but never count up | Tweening $184.80 from zero renders $137.44 on the way. On a page whose entire argument is that its numbers are traceable, an easing curve must not invent a precise valuation, however briefly. |
| 2026-08-29 | Disclosure panels fade, they do not grow from zero height | Measured: animating height from 0 shrinks the document, the browser clamps scroll to the shorter page, and the reader lands 72px from where they were. Fading the contents has no such cost. |
