import type { LiveAnalysisEnvelope } from "@/lib/live-analysis-types";

export const liveAnalysisFixture: LiveAnalysisEnvelope = {
  ticker: "AAPL",
  cik: "0000320193",
  companyName: "Apple Inc.",
  secRetrievedAt: "2026-08-29T10:00:00Z",
  latestFiling: {
    accessionNumber: "0000320193-25-000003",
    filingForm: "10-K",
    filingDate: "2025-01-31",
    reportDate: "2024-12-31",
    filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/filing.htm",
  },
  missingMetrics: [],
  normalizationWarnings: [],
  analysis: {
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "sector-priors-v1",
      classification: { sectorDisplayName: "Technology", businessType: "Operating company" },
    },
    finalValuation: {
      inputs: {
        startingFreeCashFlow: 106_000_000_000,
        netDebt: 35_000_000_000,
        dilutedShares: 15_200_000_000,
        currency: "USD",
      },
      assumptions: {
        stageOneYears: 5,
        stageTwoYears: 5,
        stageOneGrowthRate: 0.0967,
        stageTwoGrowthRate: 0.0567,
        terminalGrowthRate: 0.03,
        discountRate: 0.1315,
      },
      terminalValue: { concentration: 0.4335, presentValue: 620_000_000_000 },
      decomposition: {
        presentValueProjectedCashFlows: 810_000_000_000,
        presentValueTerminalValue: 620_000_000_000,
        enterpriseValue: 1_430_000_000_000,
        netDebt: 35_000_000_000,
        equityValue: 1_395_000_000_000,
      },
      intrinsicValuePerShare: 96.86,
      sensitivityInterval: {
        isProbabilityInterval: false,
        lowerBoundPerShare: 78.69,
        centralValuePerShare: 96.86,
        upperBoundPerShare: 124.14,
      },
      warnings: [],
    },
    deterministicChecklist: [
      {
        checklistNumber: 1,
        checklistText: "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat",
        status: "SUPPORTS",
        plainEnglishExplanation: "The reported gross margin is above the checklist threshold.",
        technicalExplanation: "Gross profit divided by revenue exceeds 20%.",
        applicabilityReason: "Applicable to this operating company.",
        missingInformation: [],
        sectorContext: "Technology margins vary by business mix.",
        potentialValuationRelevance: "Durable margins may support cash-flow assumptions.",
        evidenceReferences: [
          {
            evidenceId: "sec:gross-profit:2024",
            sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/filing.htm",
            filingForm: "10-K",
            fiscalPeriod: "FY",
            xbrlConcept: "GrossProfit",
          },
        ],
      },
    ],
    adjustments: [],
    evidenceAssessment: [
      {
        statement: "Reported cash generation supports a positive starting free cash flow.",
        claimType: "FACT",
        support: "SUPPORTED",
        evidenceReferences: [
          {
            evidenceId: "sec:cash-flow:2024",
            sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/filing.htm",
            filingForm: "10-K",
            xbrlConcept: "NetCashProvidedByUsedInOperatingActivities",
          },
        ],
      },
    ],
    confidence: {
      level: "Medium",
      score: 0.72,
      isProbability: false,
      explanation: "Coverage is adequate, but the result remains sensitive to long-run assumptions.",
    },
    disagreement: { summary: "No material AI and deterministic disagreement was recorded." },
  },
};

export function backendPayloadFromFixture(): Record<string, unknown> {
  const snake = snakeCaseKeys(liveAnalysisFixture) as Record<string, unknown>;
  const analysis = snake.analysis as Record<string, unknown>;
  analysis.deterministic_checklist = {
    results: analysis.deterministic_checklist,
  };
  return snake;
}

function snakeCaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snakeCaseKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      snakeCaseKeys(child),
    ]),
  );
}
