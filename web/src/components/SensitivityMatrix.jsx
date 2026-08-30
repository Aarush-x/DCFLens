import { priceShort, percent, EMPTY } from '../lib/format.js'
import './SensitivityMatrix.css'

/* The sensitivity matrix — value per share across the growth assumption (rows)
 * against the discount rate (columns). The densest thing in the product, and so it
 * lives at the bottom of the Why layer and nowhere else: product non-negotiable #1
 * keeps a grid of twenty-five DCF outputs off the default screen.
 *
 * ── Why this recomputes, and why that is not "inventing a grid" ───────────────
 * `final_valuation.sensitivity_interval` publishes three values — the central case,
 * and the two corners it reached by shifting growth by −δ / +δ and the discount rate
 * by +δ / −δ (method: "symmetric_assumption_perturbation"). Its `evaluated_points`
 * carry those two corners and nothing else. Three points do not make a matrix, so
 * the other twenty-two cells are computed here, from the same assumptions the drawer
 * above already prints.
 *
 * That is a reconstruction of the engine's model, not a second model of our own, and
 * it is held to that claim: THE_ANCHORS below re-derive the three published figures
 * from this file's own arithmetic, and if any of them disagrees by more than
 * AGREEMENT the whole component renders nothing. A grid that cannot reproduce the
 * numbers printed elsewhere on the page has no business being on the page —
 * non-negotiable #3, refuse rather than guess, applied to our own maths.
 *
 * (Verified 2026-08-30 against src/mocks/msft-live.json: this arithmetic reproduces
 * central 159.65966235522427, lower 127.30222331999256 and upper 212.20435574079286
 * to within 1e-13.)
 *
 * ── What "growth" means on the row axis ──────────────────────────────────────
 * The engine's perturbation moves EVERY growth assumption together — stage one,
 * stage two and terminal growth all shift by the same δ. So does a row here; it has
 * to, or the corner cells would not land on the published bounds. Rows are labelled
 * with the stage-one rate because that is the figure the drawer above calls
 * "Growth, years 1–5", and the caption says the rest move with it.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * A cell is tinted by where its value sits against TODAY'S SHARE PRICE, which is the
 * only thing that makes "cheap" or "expensive" mean anything. The live service
 * carries no price (see adapter.js, NO_PRICE), so today every cell renders untinted
 * and the component says why. Tinting against a zero we invented would turn the
 * whole grid green and state, in colour, something we do not know.
 */

/* Rows and columns, in units of the published δ. The ±1 ring is where the engine
   itself evaluated; the ±2 ring is the same closed-form model carried one step
   further, which is arithmetic rather than estimation. Ordered low → high in both
   directions, so the table reads like the list it is. */
export const STEPS = [-2, -1, 0, 1, 2]

/* A terminal value needs the discount rate to exceed perpetual growth, and needs to
   exceed it by enough to mean something: at a half-point spread the terminal value
   is two hundred times the final year's cash flow, which is not a valuation, it is a
   divide-by-nearly-zero. Such a cell is refused, not printed. */
const MIN_SPREAD = 0.005

/* How far a rebuilt anchor may sit from the published one before we disown the whole
   grid. 0.5% is far wider than float drift (observed: 1e-13 relative) and far
   narrower than any real modelling difference. */
const AGREEMENT = 0.005

/** the_math carries rates as percentage points; the maths wants fractions. */
const rate = (pct) => (Number.isFinite(pct) ? pct / 100 : null)

/**
 * The engine's two-stage DCF, per share, with growth and the discount rate shifted
 * by whole percentage points. Mirrors app/valuation — projected years discounted at
 * (1+r)^y, a Gordon terminal value on the final year, net debt subtracted, divided
 * by diluted shares.
 *
 * @returns {number|null}  null where the model has no answer, never a fallback number
 */
export function perShare(m, growthShiftPct, discountShiftPct) {
  const g1 = rate(m.stage_1?.growth_pct)
  const g2 = rate(m.stage_2?.growth_pct)
  const gt = rate(m.terminal_growth_pct)
  const r0 = rate(m.discount_rate_pct)
  const n1 = m.stage_1?.years
  const n2 = m.stage_2?.years
  const fcf0 = m.starting_free_cash_flow
  const netDebt = m.net_debt
  const shares = m.shares_outstanding

  if ([g1, g2, gt, r0, fcf0, netDebt].some((v) => !Number.isFinite(v))) return null
  if (!Number.isFinite(n1) || !Number.isFinite(n2) || n1 < 1 || n2 < 0) return null
  if (!Number.isFinite(shares) || shares <= 0) return null

  const dg = rate(growthShiftPct)
  const G1 = g1 + dg
  const G2 = g2 + dg
  const GT = gt + dg
  const R = r0 + rate(discountShiftPct)

  if (!(R > 0) || R - GT <= MIN_SPREAD) return null

  const years = Math.round(n1 + n2)
  let flow = fcf0
  let pv = 0
  for (let y = 1; y <= years; y += 1) {
    flow *= 1 + (y <= n1 ? G1 : G2)
    pv += flow / (1 + R) ** y
  }
  pv += (flow * (1 + GT)) / (R - GT) / (1 + R) ** years

  // net_debt is signed: MSFT's is −$36.5B, i.e. more cash than debt, which ADDS to
  // equity. Subtraction is what makes that come out right.
  const value = (pv - netDebt) / shares
  return Number.isFinite(value) ? value : null
}

/** The three cells the envelope publishes a figure for, as [growthStep, discountStep]
 *  and the key that figure arrives under. The pessimistic corner is growth down AND
 *  the discount rate up; the optimistic corner is the mirror of it. */
export const ANCHORS = [
  { g: 0, d: 0, key: 'central_per_share' },
  { g: -1, d: +1, key: 'low_per_share' },
  { g: +1, d: -1, key: 'high_per_share' },
]

/** Does our arithmetic reproduce what the backend published? */
export function reproducesPublished(m, s) {
  return ANCHORS.every(({ g, d, key }) => {
    const mine = perShare(m, g * s.growth_delta_pct, d * s.discount_delta_pct)
    const theirs = s[key]
    if (mine === null || !Number.isFinite(theirs) || theirs === 0) return false
    return Math.abs(mine - theirs) <= Math.abs(theirs) * AGREEMENT
  })
}

/* How far from today's price a value has to sit before we colour it as cheap or
   expensive rather than about right. A display band, not a recommendation — it is
   the same "no bargain, no warning" middle the range bar draws. */
const NEAR_BAND = 0.1

/** 'under' | 'fair' | 'over', or null when there is no price to judge against. */
export function tintFor(value, current) {
  if (!Number.isFinite(current) || current <= 0 || value === null) return null
  const margin = (value - current) / current
  if (margin > NEAR_BAND) return 'under'
  if (margin < -NEAR_BAND) return 'over'
  return 'fair'
}

/**
 * @param {object}      props
 * @param {object|null} props.math   `the_math` from the adapter
 * @param {number|null} props.price  today's share price, or null — the live state
 */
export default function SensitivityMatrix({ math, price = null }) {
  // No valuation, no matrix. Same contract as every other block in the drawer.
  if (!math) return null

  const s = math.sensitivity
  if (!s) return null
  if (!reproducesPublished(math, s)) return null

  const centralGrowth = math.stage_1?.growth_pct
  const centralDiscount = math.discount_rate_pct
  if (!Number.isFinite(centralGrowth) || !Number.isFinite(centralDiscount)) return null

  const cols = STEPS.map((d) => ({ step: d, pct: centralDiscount + d * s.discount_delta_pct }))
  const rows = STEPS.map((g) => ({
    step: g,
    pct: centralGrowth + g * s.growth_delta_pct,
    cells: cols.map((c) => {
      const value = perShare(math, g * s.growth_delta_pct, c.step * s.discount_delta_pct)
      return {
        step: c.step,
        value,
        tint: tintFor(value, price),
        // The assumptions we actually used — the one cell that is not a what-if.
        here: g === 0 && c.step === 0,
      }
    }),
  }))

  const priced = Number.isFinite(price) && price > 0

  return (
    <section className="sensmatrix" aria-labelledby="sens-h">
      <h4 id="sens-h">If our two biggest assumptions were different</h4>
      <p className="sensgloss">
        Down the side, how fast we assume spare cash grows. Across the top, the
        discount rate — how much we shrink future money, to account for risk and for
        waiting. Every figure is what one share would be worth on that pair.
      </p>

      <div className="senswrap">
        <table className="senstable">
          <caption className="senscap">
            Small changes in our assumptions move the answer this much.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="senscorner">
                <span className="axisg">Growth ↓</span>
                <span className="axisd">Discount rate →</span>
              </th>
              {cols.map((c) => (
                <th scope="col" key={c.step} className={c.step === 0 ? 'on' : undefined}>
                  {percent(c.pct)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.step}>
                <th scope="row" className={row.step === 0 ? 'on' : undefined}>
                  {percent(row.pct)}
                </th>
                {row.cells.map((cell) => (
                  <td
                    key={cell.step}
                    className={[
                      cell.tint ? `t-${cell.tint}` : '',
                      cell.here ? 'here' : '',
                      cell.value === null ? 'missing' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell.value === null ? EMPTY : priceShort(cell.value)}
                    {cell.here && <span className="sr-only"> — the assumptions we used</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="sensnote">
        The outlined cell is what we actually assumed. Moving down a row raises every
        growth assumption together — the first years, the years after, and the pace
        forever after that — which is how the engine builds its own range, so the
        corners of this grid are the two ends of it.
        {' '}
        {priced ? (
          <>Green sits more than {Math.round(NEAR_BAND * 100)}% above today&rsquo;s{' '}
          {priceShort(price)}, red more than {Math.round(NEAR_BAND * 100)}% below, amber
          in between.</>
        ) : (
          <>Nothing here is coloured against today&rsquo;s share price, because we
          don&rsquo;t have one.</>
        )}
      </p>
    </section>
  )
}
