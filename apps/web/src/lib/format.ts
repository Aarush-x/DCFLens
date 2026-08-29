const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatUsd(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Large money as `$99.0bn`, matching the house convention for headline figures. */
export function formatCompactUsd(value: number, currency = "USD"): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const scales: [number, string][] = [
    [1e12, "tn"],
    [1e9, "bn"],
    [1e6, "m"],
    [1e3, "k"],
  ];
  for (const [divisor, suffix] of scales) {
    if (magnitude >= divisor) {
      return `${sign}${symbol}${(magnitude / divisor).toFixed(1)}${suffix}`;
    }
  }
  return `${sign}${symbol}${magnitude.toFixed(0)}`;
}

export function formatShares(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} shares`;
}

/** Decimal fraction to a percentage string. `0.0967` becomes `9.67%`. */
export function formatRate(value: number, fractionDigits = 2): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** Signed percentage-point delta for adjustments. `0.005` becomes `+0.50pp`. */
export function formatRateDelta(value: number, fractionDigits = 2): string {
  const points = value * 100;
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(fractionDigits)}pp`;
}

export function formatSignedUsd(value: number, currency = "USD"): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatUsd(Math.abs(value), currency)}`;
}

export function formatScore(value: number): string {
  return value.toFixed(2);
}

export function formatDate(value: string): string {
  if (!PLAIN_DATE.test(value)) {
    return formatDateTime(value);
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

/** Turns `NOT_APPLICABLE` into `Not applicable` for reading aloud and on screen. */
export function humanizeStatus(status: string): string {
  const words = status.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Turns `terminal_value_concentration` into `Terminal value concentration`. */
export function humanizeKey(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
