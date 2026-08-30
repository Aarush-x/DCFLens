# DCFLens — showcase screenshots

Five frames, in the order they tell the story: the pitch, the answer, the
reasoning, the maths, and the refusal. Retina PNGs (2x), captured from the real
app in `web/`.

| # | File | What it shows |
|---|---|---|
| 1 | `01-landing.png` | **Landing hero.** "Know what a stock is actually worth." The animated first surface. |
| 2 | `02-verdict.png` | **The answer.** Verdict first and biggest, then today's price against the estimated range, with the marker on the bar. Apple / AAPL. |
| 3 | `03-reasoning.png` | **Why we think so.** What must be true · what supports · what weakens — beside the scenario table and the reverse-DCF ("the market is betting on 8.4%/yr; it has delivered 6.1%"). |
| 4 | `04-why-math.png` | **"Why? Show me the math", open.** The one place jargon is allowed, every term glossed in plain English, every figure with a source link. |
| 5 | `05-cannot-value.png` | **"We can't value this one reliably."** Refuse rather than guess — a designed state, not an error page. |

Sizes: 1–3 and 5 are 1440x900 (2880x1800 @2x), the laptop frame. 4 is a cropped
detail shot, 940x1500 (1880x3000 @2x).

## These frames are ahead of `main`

They were captured from the `feat/frontend-vite-shell` branch on 2026-08-30.
Shot 4's "View evidence" links and its "What we checked" block come from
components that are **not on `main`** — `EvidenceAudit`, `SensitivityMatrix` and
`TerminalValueShare`. Regenerating from a `main` checkout will not reproduce
shot 4 as published here. Reshoot once that branch lands.

## Regenerating

```sh
cd web && npm run dev -- --port 5199     # in one shell
cd screenshots && node capture.mjs all   # in another
```

`capture.mjs <name>` reshoots one (`node capture.mjs verdict`). Shots are
declared in the `SHOTS` array at the top of the file — url, settle time, and
optionally a click and a scroll target. PNGs are written beside the script;
they are not put in an `out/` directory because `.gitignore` has a
build-artifact rule for `out/` that matches at any depth, which would silently
leave them untracked.

A sixth shot, the empty **search state**, is defined but excluded from `all`:
`node capture.mjs search`. It was cut because it is the most generic screen in
the product — a field on black — and shot 2 already carries the search bar.

Read the header comment in `capture.mjs` before changing how it frames a shot:
a full-page capture of this app produces a *wrong* picture, not merely a tall
one, because the layout is viewport-anchored (`.rail` is `height: 100vh` and
`#wipe` is a fixed panel parked one viewport below the fold).

## Two things visible in these frames that are not yet decided

Both are pre-existing and were photographed as-is.

- **Word spaces collapse in every display headline.** "Know what a stock is"
  renders as "Knowwhat astockis"; likewise "Whatareyouthinkingof" on the search
  screen and "Wecan'tvaluethisone" on the refusal. Cause is
  `letter-spacing: -.045em` on `--fd` (`web/src/styles/index.css:160,211`),
  which at headline sizes subtracts more than the space glyph is wide. A
  `word-spacing` bump on the same rules would fix it without loosening the
  letter tracking.
- **The history rail is seeded with five companies** in all four app shots,
  which contradicts the search-first design the rail is supposed to follow — it
  is meant to start empty and fill from use. If the seeds are pulled from
  `web/src/components/app/RecentRail.jsx`, shots 2–5 need a reshoot.
