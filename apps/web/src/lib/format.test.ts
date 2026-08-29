import { describe, expect, it } from "vitest";

import {
  formatCompactUsd,
  formatRate,
  formatRateDelta,
  formatSignedUsd,
  formatUsd,
  humanizeKey,
  humanizeStatus,
} from "@/lib/format";

describe("formatting", () => {
  it("formats per-share money with aligned decimal precision", () => {
    expect(formatUsd(96.86)).toBe("$96.86");
    expect(formatUsd(-4.27)).toBe("-$4.27");
  });

  it("formats large figures compactly", () => {
    expect(formatCompactUsd(115_164_000_000)).toBe("$115.2bn");
    expect(formatCompactUsd(-34_600_000_000)).toBe("-$34.6bn");
    expect(formatCompactUsd(900)).toBe("$900");
  });

  it("renders decimal rates as percentages", () => {
    expect(formatRate(0.0967)).toBe("9.67%");
    expect(formatRate(0.432, 1)).toBe("43.2%");
  });

  it("renders adjustments as signed percentage points", () => {
    expect(formatRateDelta(0.011)).toBe("+1.10pp");
    expect(formatRateDelta(-0.006)).toBe("−0.60pp");
    expect(formatRateDelta(0)).toBe("0.00pp");
  });

  it("signs per-share impacts", () => {
    expect(formatSignedUsd(1.5)).toBe("+$1.50");
    expect(formatSignedUsd(-1.5)).toBe("−$1.50");
  });

  it("reads enum values aloud as words", () => {
    expect(humanizeStatus("NOT_APPLICABLE")).toBe("Not applicable");
    expect(humanizeKey("terminal_value_concentration")).toBe("Terminal value concentration");
  });
});
