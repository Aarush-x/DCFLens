import { describe, expect, it } from "vitest";

import { analysisFixtures, fixtureScenarios, getAnalysisFixture } from "@/fixtures/analysis";
import { ORIGINAL_CHECKLIST } from "@/lib/checklist-contract";
import type { AnalysisEnvelope } from "@/lib/analysis-types";

const entries = Object.entries(analysisFixtures);

describe("analysis fixtures", () => {
  it("registers one fixture per documented scenario", () => {
    expect(fixtureScenarios.map((scenario) => scenario.ticker).sort()).toEqual(
      Object.keys(analysisFixtures).sort(),
    );
  });

  it("resolves tickers case-insensitively and rejects unknown ones", () => {
    expect(getAnalysisFixture("aapl")).toBe(analysisFixtures.AAPL);
    expect(getAnalysisFixture(" msft ")).toBe(analysisFixtures.MSFT);
    expect(getAnalysisFixture("ZZZZ")).toBeNull();
  });

  describe.each(entries)("%s", (_ticker, envelope: AnalysisEnvelope) => {
    const checklist = envelope.analysis.deterministicChecklist;

    it("keeps the original checklist wording and order", () => {
      expect(checklist).toHaveLength(ORIGINAL_CHECKLIST.length);
      for (const [index, item] of ORIGINAL_CHECKLIST.entries()) {
        expect(checklist[index].checklistNumber).toBe(item.number);
        expect(checklist[index].checklistText).toBe(item.text);
      }
    });

    it("keeps the qualitative findings on the original wording too", () => {
      for (const finding of envelope.analysis.checklistQualitativeFindings) {
        const item = ORIGINAL_CHECKLIST.find(
          (entry) => entry.number === finding.checklistNumber,
        );
        expect(item).toBeDefined();
        expect(finding.checklistText).toBe(item?.text);
      }
    });

    it("reports a disagreement for every checklist status the two readings differ on", () => {
      const declared = new Set(
        envelope.analysis.disagreement.checklistDisagreements.map((item) => item.checklistNumber),
      );
      for (const finding of envelope.analysis.checklistQualitativeFindings) {
        const deterministic = checklist.find(
          (item) => item.checklistNumber === finding.checklistNumber,
        );
        if (deterministic !== undefined && deterministic.status !== finding.status) {
          expect(declared).toContain(finding.checklistNumber);
        }
      }
    });

    it("places the single estimate inside its own sensitivity interval", () => {
      const valuation = envelope.analysis.finalValuation;
      const interval = valuation.sensitivityInterval;
      expect(interval.lowerBoundPerShare).toBeLessThan(interval.upperBoundPerShare);
      expect(valuation.intrinsicValuePerShare).toBeGreaterThanOrEqual(interval.lowerBoundPerShare);
      expect(valuation.intrinsicValuePerShare).toBeLessThanOrEqual(interval.upperBoundPerShare);
    });

    it("never presents the interval as a probability", () => {
      expect(envelope.analysis.finalValuation.sensitivityInterval.isProbabilityInterval).toBe(false);
      expect(envelope.analysis.confidence.isProbability).toBe(false);
    });

    it("reconciles the valuation arithmetic it displays", () => {
      const valuation = envelope.analysis.finalValuation;
      const { decomposition, terminalValue } = valuation;
      const summedPresentValue = valuation.projectedCashFlows.reduce(
        (total, flow) => total + flow.presentValue,
        0,
      );

      expect(decomposition.presentValueProjectedCashFlows).toBeCloseTo(summedPresentValue, 2);
      expect(decomposition.enterpriseValue).toBeCloseTo(
        summedPresentValue + terminalValue.presentValue,
        2,
      );
      expect(decomposition.equityValue).toBeCloseTo(
        decomposition.enterpriseValue - decomposition.netDebt,
        2,
      );
      expect(valuation.intrinsicValuePerShare).toBeCloseTo(
        decomposition.equityValue / valuation.dilutedShares,
        6,
      );
      expect(terminalValue.concentration).toBeCloseTo(
        terminalValue.presentValue / decomposition.enterpriseValue,
        6,
      );
    });

    it("keeps the discount rate above terminal growth", () => {
      for (const assumptions of [
        envelope.analysis.deterministicBaseline.assumptions,
        envelope.analysis.finalAssumptions,
      ]) {
        expect(assumptions.discountRate).toBeGreaterThan(assumptions.terminalGrowthRate);
      }
    });

    it("resolves every cited evidence id to a real reference", () => {
      const known = new Set(envelope.evidence.map((reference) => reference.evidenceId));
      const cited = [
        ...envelope.narrative.whatMustBeTrue,
        ...envelope.narrative.whatSupports,
        ...envelope.narrative.whatWeakens,
        ...envelope.narrative.whatCouldProveItWrong,
      ].flatMap((claim) => claim.evidenceIds);

      for (const id of [
        ...cited,
        ...envelope.analysis.evidenceAssessment.flatMap((item) => item.evidenceIds),
        ...envelope.analysis.adjustments.flatMap((item) => item.evidenceIds),
        ...checklist.flatMap((item) => item.evidenceIds),
      ]) {
        expect(known).toContain(id);
      }
    });

    it("links every evidence reference to a real SEC URL", () => {
      for (const reference of envelope.evidence) {
        expect(reference.sourceUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
      }
      expect(envelope.latestFiling.documentUrl).toMatch(/^https:\/\/www\.sec\.gov\//);
      expect(envelope.latestFiling.filingIndexUrl).toMatch(/-index\.htm$/);
    });

    it("carries the provenance the technical layer has to show", () => {
      expect(envelope.methodologyVersion).not.toBe("");
      expect(envelope.analysisVersion).not.toBe("");
      expect(envelope.analysis.deterministicBaseline.priorVersion).not.toBe("");
      expect(envelope.dataFreshness.secRetrievedAt).not.toBe("");
    });

    it("only carries adjustments the baseline can be reconciled against", () => {
      for (const adjustment of envelope.analysis.adjustments) {
        expect(adjustment.finalAssumption).toBeCloseTo(
          adjustment.baselineAssumption + adjustment.aiAdjustment,
          10,
        );
        expect(adjustment.aiAdjustment).toBeGreaterThanOrEqual(adjustment.minimumAdjustment);
        expect(adjustment.aiAdjustment).toBeLessThanOrEqual(adjustment.maximumAdjustment);
      }
    });
  });
});

describe("fixture coverage", () => {
  it("covers every checklist status somewhere in the set", () => {
    const seen = new Set(
      entries.flatMap(([, envelope]) =>
        envelope.analysis.deterministicChecklist.map((item) => item.status),
      ),
    );
    expect([...seen].sort()).toEqual([
      "MONITOR",
      "NOT_APPLICABLE",
      "SUPPORTS",
      "UNKNOWN",
      "WEAKENS",
    ]);
  });

  it("covers a missing market price, a negative valuation, and an unavailable model", () => {
    expect(entries.some(([, envelope]) => envelope.marketPrice === null)).toBe(true);
    expect(
      entries.some(([, envelope]) => envelope.analysis.finalValuation.intrinsicValuePerShare < 0),
    ).toBe(true);
    expect(
      entries.some(([, envelope]) => envelope.analysis.status === "DETERMINISTIC_FALLBACK"),
    ).toBe(true);
    expect(entries.some(([, envelope]) => envelope.missingMetrics.length > 0)).toBe(true);
  });
});
