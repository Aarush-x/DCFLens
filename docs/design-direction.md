# Design direction: Editorial Research Terminal

## Product context

DCFLens is an evidence-first equity research and deterministic valuation product. The landing experience is for investors and analysts who want one valuation, a visible assumption trail, and direct SEC provenance without the visual language of trading terminals or generic AI dashboards.

## Direction

The visual system combines an editorial publication's hierarchy and whitespace with the alignment discipline of a research terminal. Typography carries the identity. Rules, tabular numbers, accession references, and small status labels provide structure. Decoration is minimal and functional.

The deliberate visual risk is Clash Display at headline scale. It gives the product a recognizable editorial voice, but it is restricted to major headings. Instrument Sans remains the interface voice, and IBM Plex Mono is reserved for evidence IDs, rates, money, and aligned financial data.

## Design principles

1. One subject per section. The page should feel paced, not tiled.
2. Evidence is a first-class interaction, never a footnote hidden behind an icon.
3. Tables and ledgers replace generic dashboard cards.
4. Color is rare. Cobalt marks interactive intent; semantic status colors communicate evaluation only.
5. Spacing establishes trust. Dense financial rows sit inside generous editorial sections.
6. Motion is optional and functional. The initial system uses no choreography or GSAP.
7. Fixture data must be labeled so an illustrative valuation cannot be mistaken for live research.

## Typography

- Display: Clash Display, loaded through Fontshare's authorized webfont service with `display=optional`. Fallbacks use the self-hosted body face and system sans-serifs.
- Body and interface: Instrument Sans variable, self-hosted through `next/font/local` with its OFL license.
- Financial data: IBM Plex Mono Regular and Medium, self-hosted through `next/font/local` with its OFL license.

Clash Display is not committed as a font binary. Fontshare identifies it as a closed-source ITF Free Font License family. The published license permits commercial use but restricts independent webfont transmission. Instrument Sans and IBM Plex Mono use SIL OFL 1.1, which permits bundling and embedding when the license and copyright notice are preserved.

## Color

- Paper: `#f4f1e8`
- Raised paper: `#fbfaf6`
- Ink: `#171816`
- Muted ink: `#62645d`
- Hairline: `#d5d1c6`
- Strong line: `#a8a398`
- Accent cobalt: `#2457d6`
- Accent hover: `#173fa6`
- Inverse ink: `#f7f4eb`

Semantic status colors are reserved for checklist meaning and never used decoratively: supports `#1d6949`, weakens `#9a3e2f`, monitor `#8a6415`, unknown `#666963`, and not applicable `#5b6170`.

## Layout and spacing

The system uses a 4px base unit and a spacious scale from 4px to 128px. The desktop page uses a twelve-column editorial grid inside a 1280px maximum width. Tablet layouts reduce to six columns; mobile uses one column. Section boundaries are thin horizontal rules rather than containers with shadows.

Controls use 2px radii, 44px minimum target heights, visible focus rings, and no decorative icons. Data rows use tabular figures and right alignment where values share a column.

## Loading and errors

Loading states preserve final geometry with quiet neutral blocks and reduced-motion support. Errors use plain language, a retry action, and no internal detail. Both states use the same navigation, spacing, type, and control primitives as the landing page.

## Font license sources

- Fontshare ITF Free Font License: https://www.fontshare.com/licenses/itf-ffl
- Instrument Sans upstream and OFL: https://github.com/Instrument/instrument-sans
- IBM Plex upstream and OFL: https://github.com/IBM/plex
