import { describe, expect, it } from "vitest";
import { fixtureAnalysis, formatUsd } from "./analysis";

describe("analysis fixture", () => {
  it("preserves the original checklist wording and order", () => {
    expect(fixtureAnalysis.checklist.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(fixtureAnalysis.checklist[0].text).toBe("Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat");
    expect(fixtureAnalysis.checklist[9].text).toBe("Subsidiaries: Not too many (check for siphoning risk)");
  });

  it("keeps one final valuation inside its sensitivity interval", () => {
    const { intrinsicValuePerShare, sensitivityLow, sensitivityHigh } = fixtureAnalysis.valuation;
    expect(intrinsicValuePerShare).toBeGreaterThan(sensitivityLow);
    expect(intrinsicValuePerShare).toBeLessThan(sensitivityHigh);
  });

  it("formats financial values with aligned decimal precision", () => {
    expect(formatUsd(96.86)).toBe("$96.86");
  });
});
