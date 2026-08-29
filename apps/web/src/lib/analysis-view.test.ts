import { describe, expect, it } from "vitest";

import { analysisFixtures } from "@/fixtures/analysis";
import { buildAnalysisView } from "@/lib/analysis-view";

const view = (ticker: string) => buildAnalysisView(analysisFixtures[ticker]);

describe("verdict tone", () => {
  it("does not turn supportive merely because the estimate is positive", () => {
    for (const ticker of ["AAPL", "INTC", "JPM", "TSLA", "NKE"]) {
      const result = view(ticker);
      expect(result.isValuationMeaningful || ticker === "WBD").toBe(true);
      expect(result.tone).not.toBe("supports");
    }
  });

  it("is supportive only when the evidence, model coverage, and stability all hold", () => {
    const result = view("MSFT");
    expect(result.tone).toBe("supports");
    expect(result.evidence.label).toBe("Strong");
    expect(result.aiCoverage.level).toBe("full");
    expect(result.fragility.isFragile).toBe(false);
    expect(result.disagreement.hasDisagreement).toBe(false);
  });

  it("refuses a valuation rather than dressing up a negative one", () => {
    const result = view("WBD");
    expect(result.isValuationMeaningful).toBe(false);
    expect(result.tone).toBe("weakens");
    expect(result.verdict).toContain("cannot put a reliable value");
    expect(analysisFixtures.WBD.analysis.finalValuation.warnings).toContain(
      "non_positive_equity_value",
    );
  });
});

describe("disagreement", () => {
  it("states the cheap-but-fragile case in the required words", () => {
    const result = view("INTC");
    expect(result.price.position).toBe("below_interval");
    expect(result.fragility.isFragile).toBe(true);
    expect(result.disagreement.headline).toBe(
      "Apparently cheap, but the evidence suggests the valuation is fragile.",
    );
  });

  it("keeps each disagreement as its own statement rather than one score", () => {
    const result = view("INTC");
    expect(result.disagreement.statements.length).toBeGreaterThan(1);
    expect(new Set(result.disagreement.statements.map((item) => item.kind)).size).toBe(
      result.disagreement.statements.length,
    );
    expect(result.disagreement.checklistDisagreements).toHaveLength(2);
    for (const item of result.disagreement.checklistDisagreements) {
      expect(item.deterministicStatus).not.toBe(item.aiStatus);
    }
  });

  it("says so plainly when nothing conflicts", () => {
    const result = view("MSFT");
    expect(result.disagreement.hasDisagreement).toBe(false);
    expect(result.disagreement.checklistDisagreements).toHaveLength(0);
  });

  it("always surfaces the analysis's own summary of the two readings", () => {
    for (const ticker of Object.keys(analysisFixtures)) {
      const summary = analysisFixtures[ticker].analysis.disagreement.summary;
      expect(
        buildAnalysisView(analysisFixtures[ticker]).disagreement.statements.map(
          (item) => item.text,
        ),
      ).toContain(summary);
    }
  });

  it("keeps the cut-off explanation visible when the model returned only part", () => {
    const result = view("NKE");
    expect(result.disagreement.headline).toContain("before the response was cut off");
  });

  it("says there is no second reading when the model never ran", () => {
    const result = view("TSLA");
    expect(result.disagreement.headline).toContain("no second reading");
  });

  it("surfaces an applied assumption change as its own statement", () => {
    const result = view("NKE");
    expect(
      result.disagreement.statements.some((item) => item.kind === "model_versus_baseline"),
    ).toBe(true);
  });
});

describe("price comparison", () => {
  it("says what is missing instead of guessing a price", () => {
    const result = view("JPM");
    expect(result.price.isAvailable).toBe(false);
    expect(result.price.position).toBe("unavailable");
    expect(result.price.price).toBeNull();
    expect(result.price.statement).toContain("do not have a market price");
    expect(result.verdictDetail).toContain("cannot tell you whether a share is cheap");
  });

  it("places a price inside, below, and above the interval", () => {
    expect(view("AAPL").price.position).toBe("inside_interval");
    expect(view("INTC").price.position).toBe("below_interval");
    expect(view("TSLA").price.position).toBe("above_interval");
  });
});

describe("model coverage", () => {
  it("reports an unavailable model without silently substituting anything", () => {
    const result = view("TSLA");
    expect(result.aiCoverage.level).toBe("unavailable");
    expect(analysisFixtures.TSLA.analysis.adjustments).toHaveLength(0);
    expect(analysisFixtures.TSLA.analysis.fallbackReason).not.toBeNull();
    expect(
      analysisFixtures.TSLA.analysis.finalValuation.intrinsicValuePerShare,
    ).toBe(analysisFixtures.TSLA.analysis.baselineValuation.intrinsicValuePerShare);
  });

  it("reports a partial model result as partial", () => {
    const result = view("NKE");
    expect(result.aiCoverage.level).toBe("partial");
    expect(result.aiCoverage.reason).toContain("4 of the 10");
  });

  it("reports full coverage when every checklist point came back", () => {
    expect(view("AAPL").aiCoverage.level).toBe("full");
  });
});

describe("checklist summary", () => {
  it("counts every status without collapsing them", () => {
    const result = view("JPM");
    const counts = result.checklistSummary.counts;
    expect(counts.NOT_APPLICABLE).toBeGreaterThan(0);
    expect(counts.UNKNOWN).toBeGreaterThan(0);
    expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBe(10);
    expect(result.checklistSummary.statement).toContain("does not apply");
  });
});

describe("fragility", () => {
  it("gives a reason for every cautious reading", () => {
    for (const ticker of Object.keys(analysisFixtures)) {
      const result = view(ticker);
      if (result.fragility.isFragile) {
        expect(result.fragility.reasons.length).toBeGreaterThan(0);
      } else {
        expect(result.fragility.reasons).toHaveLength(0);
      }
    }
  });
});
