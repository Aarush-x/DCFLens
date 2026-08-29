/* Number formatting. Every figure on screen goes through here.
   Formats are taken from design/index.html, not invented:
     $99.0B · −$50.0B · 15.2B · $178.20 · $165 · 8.0% · 8.4% · +3.7%
   Negatives use U+2212 MINUS SIGN, and the sign sits outside the $ — "−$50.0B",
   which is how the mockup's "Debt, minus cash" row renders. */

const MINUS = '−'
export const EMPTY = '—' // em dash, for null / missing — never "0"

const isNum = (n) => typeof n === 'number' && Number.isFinite(n)

const SCALES = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
]

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Compact magnitude without a currency symbol: 15200000000 -> "15.2B" */
export function count(n) {
  if (!isNum(n)) return EMPTY
  const abs = Math.abs(n)
  const sign = n < 0 ? MINUS : ''
  for (const [size, suffix] of SCALES) {
    if (abs >= size) return `${sign}${(abs / size).toFixed(1)}${suffix}`
  }
  return `${sign}${group(String(Math.round(abs)))}`
}

/** Large figures compact, everything else as a price: 99e9 -> "$99.0B", 178.2 -> "$178.20" */
export function money(n) {
  if (!isNum(n)) return EMPTY
  if (Math.abs(n) >= 1e6) {
    const c = count(n)
    return c.startsWith(MINUS) ? `${MINUS}$${c.slice(1)}` : `$${c}`
  }
  return price(n)
}

/** Always two decimals: 178.2 -> "$178.20". Per-share values and quotes. */
export function price(n) {
  if (!isNum(n)) return EMPTY
  const abs = Math.abs(n)
  const [whole, frac] = abs.toFixed(2).split('.')
  return `${n < 0 ? MINUS : ''}$${group(whole)}.${frac}`
}

/** Whole dollars, for axis ticks and range-band labels: 165 -> "$165" */
export function priceShort(n) {
  if (!isNum(n)) return EMPTY
  const abs = Math.abs(n)
  return `${n < 0 ? MINUS : ''}$${group(String(Math.round(abs)))}`
}

/** One decimal, always: 8 -> "8.0%", 8.4 -> "8.4%" */
export function percent(n) {
  if (!isNum(n)) return EMPTY
  const abs = Math.abs(n)
  return `${n < 0 ? MINUS : ''}${abs.toFixed(1)}%`
}

/** Signed, one decimal: 3.7 -> "+3.7%", -3.7 -> "−3.7%" */
export function signedPercent(n) {
  if (!isNum(n)) return EMPTY
  if (n < 0) return `${MINUS}${Math.abs(n).toFixed(1)}%`
  return `+${n.toFixed(1)}%`
}

/** "$165 – $205". Returns EMPTY if either end is missing — we never half-print a range. */
export function range(low, high) {
  if (!isNum(low) || !isNum(high)) return EMPTY
  return `${priceShort(low)} – ${priceShort(high)}`
}

