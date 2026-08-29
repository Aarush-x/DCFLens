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
- **Duration:** 120ms micro, 180ms short, 240ms medium.
- **Current phase:** No GSAP, entrance choreography, parallax, or decorative motion.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-08-29 | Created Editorial Research Terminal system | Matches evidence-first financial research and avoids generic dashboard conventions. |
| 2026-08-29 | Limited Clash Display to headlines | Preserves editorial distinctiveness without weakening data readability. |
| 2026-08-29 | Did not self-host Clash Display | Fontshare's ITF license restricts independent webfont transmission; authorized CSS delivery is used instead. |
