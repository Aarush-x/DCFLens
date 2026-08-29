import type {
  AnalysisEnvelope,
  AppliedAdjustment,
  AssumptionTrace,
  ChecklistResult,
  ChecklistStatus,
  ConfidenceAssessment,
  DcfAssumptions,
  EvidenceReference,
  NormalizedFact,
} from "@/lib/analysis-types";
import { ORIGINAL_CHECKLIST, assertOriginalContract } from "@/lib/checklist-contract";
import { buildDcfValuation, type DcfFixtureInput } from "@/fixtures/dcf-fixture";

/**
 * Fixture analyses shaped exactly like the FastAPI `AnalysisEnvelope`.
 *
 * Every value here is illustrative. The filing URLs are real so that the
 * evidence links can be exercised, but no number was taken from a filing.
 * The page labels this on screen; nothing here may be presented as research.
 *
 * The set is deliberately chosen to cover the states the analysis view has to
 * survive: a clean result, a fragile one, a negative one, a missing-price and
 * not-applicable-heavy one, a partial model result with very long prose, and a
 * result with no model output at all.
 */

const RETRIEVED_AT = "2026-08-28T13:45:00Z";

interface FactSeed {
  metric: string;
  label: string;
  value: number;
  unit: string;
  concept: string;
  quality: "reported" | "calculated";
  transformation: string;
}

interface FilingSeed {
  form: string;
  accessionNumber: string;
  filingDate: string;
  periodOfReport: string;
  document: string;
  fiscalYear: number;
}

function accessionPath(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
}

function documentUrl(cik: string, filing: FilingSeed): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath(filing.accessionNumber)}/${filing.document}`;
}

function filingIndexUrl(cik: string, filing: FilingSeed): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionPath(filing.accessionNumber)}/${filing.accessionNumber}-index.htm`;
}

function evidenceId(cik: string, filing: FilingSeed, concept: string): string {
  return `sec:${Number(cik)}:${filing.accessionNumber}:${concept}:FY${filing.fiscalYear}`;
}

function buildFacts(
  cik: string,
  filing: FilingSeed,
  seeds: FactSeed[],
): { facts: NormalizedFact[]; evidence: EvidenceReference[] } {
  const facts: NormalizedFact[] = [];
  const evidence: EvidenceReference[] = [];

  for (const seed of seeds) {
    const id = evidenceId(cik, filing, seed.concept);
    facts.push({
      metric: seed.metric,
      label: seed.label,
      fiscalYear: filing.fiscalYear,
      fiscalPeriod: "FY",
      periodEnd: filing.periodOfReport,
      unit: seed.unit,
      value: seed.value,
      quality: seed.quality,
      evidenceIds: [id],
    });
    evidence.push({
      evidenceId: id,
      provider: "SEC EDGAR",
      cik,
      accessionNumber: filing.accessionNumber,
      filingForm: filing.form,
      filingDate: filing.filingDate,
      fiscalPeriod: `FY${filing.fiscalYear}`,
      xbrlConcept: seed.concept,
      unit: seed.unit,
      rawValue: seed.value,
      normalizedValue: seed.value,
      transformation: seed.transformation,
      sourceUrl: documentUrl(cik, filing),
      retrievedAt: RETRIEVED_AT,
    });
  }

  return { facts, evidence };
}

interface ChecklistSeed {
  status: ChecklistStatus;
  plainEnglishExplanation: string;
  technicalExplanation: string;
  applicabilityReason: string;
  sectorContext: string;
  potentialValuationRelevance: string;
  missingInformation?: string[];
  metricsUsed?: ChecklistResult["metricsUsed"];
  evidenceIds?: string[];
}

function buildChecklist(seeds: Record<number, ChecklistSeed>): ChecklistResult[] {
  const results = ORIGINAL_CHECKLIST.map((item) => {
    const seed = seeds[item.number];
    if (seed === undefined) {
      throw new Error(`Fixture is missing checklist item ${item.number}`);
    }
    return {
      checklistNumber: item.number,
      checklistText: item.text,
      status: seed.status,
      plainEnglishExplanation: seed.plainEnglishExplanation,
      technicalExplanation: seed.technicalExplanation,
      applicabilityReason: seed.applicabilityReason,
      metricsUsed: seed.metricsUsed ?? [],
      evidenceIds: seed.evidenceIds ?? [],
      missingInformation: seed.missingInformation ?? [],
      sectorContext: seed.sectorContext,
      potentialValuationRelevance: seed.potentialValuationRelevance,
    } satisfies ChecklistResult;
  });
  assertOriginalContract(results.map((result) => ({ number: result.checklistNumber, text: result.checklistText })));
  return results;
}

function trace(
  assumption: string,
  label: string,
  overrides: Partial<AssumptionTrace> & Pick<AssumptionTrace, "finalBaseline">,
): AssumptionTrace {
  return {
    assumption,
    label,
    // Only a trace that actually consulted a sector prior states one.
    sectorPrior: null,
    companyModifiers: [],
    fallbacks: [],
    boundsApplied: [],
    dataCoverageConfidence: 0.9,
    stabilityConfidence: 0.8,
    plainEnglishExplanation: "",
    technicalExplanation: "",
    evidenceIds: [],
    ...overrides,
  };
}

function applyAdjustments(
  baseline: DcfAssumptions,
  adjustments: Pick<AppliedAdjustment, "assumption" | "aiAdjustment">[],
): DcfAssumptions {
  const final = { ...baseline };
  for (const adjustment of adjustments) {
    switch (adjustment.assumption) {
      case "stage_one_growth_rate":
        final.stageOneGrowthRate += adjustment.aiAdjustment;
        break;
      case "stage_two_growth_rate":
        final.stageTwoGrowthRate += adjustment.aiAdjustment;
        break;
      case "terminal_growth_rate":
        final.terminalGrowthRate += adjustment.aiAdjustment;
        break;
      case "discount_rate":
        final.discountRate += adjustment.aiAdjustment;
        break;
      default:
        throw new Error(`Unknown adjustable assumption ${adjustment.assumption}`);
    }
  }
  return final;
}

function confidence(
  level: ConfidenceAssessment["level"],
  factors: [string, string, number, string][],
): ConfidenceAssessment {
  const scored = factors.map(([name, label, score, explanation]) => ({
    name,
    label,
    score,
    explanation,
  }));
  return {
    level,
    score: scored.reduce((total, factor) => total + factor.score, 0) / scored.length,
    isProbability: false,
    factors: scored,
    explanation:
      "Confidence summarizes data quality, model sensitivity, evidence support, and disagreement. It is not the probability that the intrinsic value will be reached.",
  };
}

const STANDARD_CONFIDENCE_LABELS: Record<string, string> = {
  data_coverage: "How much of the needed data we found",
  cash_flow_stability: "How steady past cash generation has been",
  sensitivity: "How much the estimate moves when assumptions move",
  terminal_value_concentration: "How much rests on the far future",
  evidence_support: "How well written claims are backed by filings",
  ai_deterministic_disagreement: "How much the written review and the numbers agree",
};

function factor(name: string, score: number, explanation: string): [string, string, number, string] {
  return [name, STANDARD_CONFIDENCE_LABELS[name] ?? name, score, explanation];
}

// ---------------------------------------------------------------------------
// Scenario 1 — Apple: model applied in full, price sits inside the range.
// ---------------------------------------------------------------------------

const appleFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0000320193-25-000073",
  filingDate: "2025-11-01",
  periodOfReport: "2025-09-27",
  document: "aapl-20250927.htm",
  fiscalYear: 2025,
};

const appleFactData = buildFacts("0000320193", appleFiling, [
  { metric: "revenue", label: "Revenue", value: 416_161_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 195_651_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: 112_010_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 127_874_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 12_710_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 115_164_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow minus absolute capital expenditure for the same period" },
  { metric: "total_debt", label: "Total debt", value: 98_186_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 55_374_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 66_758_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 14_940_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const appleBaselineAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.0967,
  stageTwoGrowthRate: 0.0567,
  terminalGrowthRate: 0.03,
  discountRate: 0.1315,
};

const appleDcfInput: DcfFixtureInput = {
  startingFreeCashFlow: 115_164_000_000,
  netDebt: 98_186_000_000 - 55_374_000_000,
  dilutedShares: 14_940_000_000,
  currency: "USD",
  assumptions: appleBaselineAssumptions,
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
  historicalFreeCashFlows: [
    92_953_000_000, 99_584_000_000, 111_443_000_000, 108_807_000_000, 115_164_000_000,
  ],
};

const appleAdjustments: AppliedAdjustment[] = [
  {
    assumption: "stage_one_growth_rate",
    label: "Growth in years 1 to 5",
    baselineAssumption: 0.0967,
    aiAdjustment: -0.006,
    finalAssumption: 0.0907,
    minimumAdjustment: -0.02,
    maximumAdjustment: 0.02,
    rationale:
      "The filing's risk factors describe concentrated supplier and regulatory exposure in two large markets, so the near-term growth assumption is trimmed slightly below the sector starting point.",
    evidenceIds: [evidenceId("0000320193", appleFiling, "RevenueFromContractWithCustomerExcludingAssessedTax")],
    isolatedIntrinsicValuePerShare: 0,
    isolatedValuationImpactPerShare: 0,
  },
];

const appleFinalAssumptions = applyAdjustments(appleBaselineAssumptions, appleAdjustments);

const appleBaselineValuation = buildDcfValuation(appleDcfInput);
const appleFinalValuation = buildDcfValuation({
  ...appleDcfInput,
  assumptions: appleFinalAssumptions,
});

appleAdjustments[0].isolatedIntrinsicValuePerShare = appleFinalValuation.intrinsicValuePerShare;
appleAdjustments[0].isolatedValuationImpactPerShare =
  appleFinalValuation.intrinsicValuePerShare - appleBaselineValuation.intrinsicValuePerShare;

const appleChecklist = buildChecklist({
      1: {
        status: "SUPPORTS",
        plainEnglishExplanation: "The company keeps 47.0% of each sales dollar after the direct cost of the product, well above the 20% mark.",
        technicalExplanation: "Gross profit / revenue = 47.0%, above the 20% threshold.",
        applicabilityReason: "Gross margin is reported and meaningful for a product company.",
        sectorContext: "Hardware and software mixes commonly report gross margins between 35% and 60%.",
        potentialValuationRelevance: "A durable margin supports the assumption that spare cash keeps growing.",
        metricsUsed: [{ name: "gross_profit_margin", value: 0.47, unit: "decimal_ratio", fiscalPeriods: ["FY2025"], calculation: "gross profit / revenue", evidenceIds: [evidenceId("0000320193", appleFiling, "GrossProfit")] }],
        evidenceIds: [evidenceId("0000320193", appleFiling, "GrossProfit"), evidenceId("0000320193", appleFiling, "RevenueFromContractWithCustomerExcludingAssessedTax")],
      },
      2: {
        status: "MONITOR",
        plainEnglishExplanation: "Sales and gross profit grew at a similar pace, but only one year of comparison is available in the retrieved facts.",
        technicalExplanation: "Revenue growth and gross-profit growth differ by less than 2 percentage points over the one comparable period.",
        applicabilityReason: "Both series are reported.",
        sectorContext: "Technology revenue mix shifts can move gross profit away from revenue for a year or two.",
        potentialValuationRelevance: "Persistent divergence would undermine the growth assumption.",
        missingInformation: ["a second comparable annual period"],
      },
      3: { status: "SUPPORTS", plainEnglishExplanation: "Earnings per share moved in line with profit; the share count fell rather than rose.", technicalExplanation: "Diluted EPS growth tracked net income growth within 1 percentage point; diluted shares declined.", applicabilityReason: "Diluted EPS and diluted average shares are both reported.", sectorContext: "Share-based pay can dilute holders in this sector; buybacks here more than offset it.", potentialValuationRelevance: "Dilution would reduce the value reaching each existing share." },
      4: { status: "MONITOR", plainEnglishExplanation: "The company owes $98.2bn against $55.4bn of cash, which is comfortable against its cash generation but is not a small balance.", technicalExplanation: "Net debt / free cash flow = 0.37x.", applicabilityReason: "Debt and cash are both reported at the period end.", sectorContext: "Large technology issuers commonly carry investment-grade debt against offshore cash.", potentialValuationRelevance: "Net debt is subtracted from enterprise value before the per-share figure." },
      5: { status: "NOT_APPLICABLE", plainEnglishExplanation: "This check is aimed at manufacturers whose inventory tells you about demand. Inventory here is small enough that it carries no signal.", technicalExplanation: "Inventory is 0.4% of revenue, below the 2% relevance floor for the inventory signal.", applicabilityReason: "Inventory is immaterial relative to revenue for this business model.", sectorContext: "An outsourced manufacturing model holds very little inventory by design.", potentialValuationRelevance: "No working-capital inference is drawn from an immaterial balance." },
      6: { status: "SUPPORTS", plainEnglishExplanation: "Money owed by customers grew more slowly than sales, so revenue is being collected rather than merely booked.", technicalExplanation: "Receivables growth is 1.8 percentage points below revenue growth; operating cash flow is positive.", applicabilityReason: "Trade receivables are a relevant collection indicator for a non-financial operating company.", sectorContext: "Direct and channel sales mixes change collection timing in this sector.", potentialValuationRelevance: "Receivables outpacing sales would consume working capital and reduce future spare cash." },
      7: { status: "SUPPORTS", plainEnglishExplanation: "The business generated $127.9bn of cash from its day-to-day operations.", technicalExplanation: "Operating cash flow is positive at $127.9bn.", applicabilityReason: "Operating cash flow is reported.", sectorContext: "Positive operating cash flow is expected for a mature issuer in this sector.", potentialValuationRelevance: "Operating cash flow is the starting point for the free-cash-flow input.", metricsUsed: [{ name: "operating_cash_flow", value: 127_874_000_000, unit: "USD", fiscalPeriods: ["FY2025"], calculation: "latest normalized operating cash flow", evidenceIds: [evidenceId("0000320193", appleFiling, "NetCashProvidedByUsedInOperatingActivities")] }], evidenceIds: [evidenceId("0000320193", appleFiling, "NetCashProvidedByUsedInOperatingActivities")] },
      8: { status: "SUPPORTS", plainEnglishExplanation: "The company earns far more than 25% on the money owners have left in the business — though buybacks have shrunk that base, which flatters the figure.", technicalExplanation: "Net income / stockholders' equity = 167.8%, above the 25% threshold. Treasury-stock buybacks materially reduce the denominator.", applicabilityReason: "Net income and stockholders' equity are both reported.", sectorContext: "Sustained buybacks distort return on equity across large technology issuers.", potentialValuationRelevance: "A high return supports reinvestment, but a shrunken equity base is not evidence of it." },
      9: { status: "UNKNOWN", plainEnglishExplanation: "The structured filing figures do not tell us how many separate businesses the company runs.", technicalExplanation: "Business-line count is not derivable from XBRL company facts.", applicabilityReason: "This item needs narrative filing text, which was not retrieved for this fixture.", sectorContext: "Segment reporting varies widely in this sector.", potentialValuationRelevance: "More business lines make a single growth assumption less reliable.", missingInformation: ["10-K Item 1 business description", "segment note"] },
      10: { status: "UNKNOWN", plainEnglishExplanation: "We do not have the list of subsidiaries, so we cannot say whether the structure is simple or complex.", technicalExplanation: "Exhibit 21 was not retrieved for this fixture.", applicabilityReason: "This item needs Exhibit 21, which was not retrieved.", sectorContext: "A large subsidiary count is normal for a multinational and is not by itself a warning.", potentialValuationRelevance: "A subsidiary count alone is not evidence of misconduct.", missingInformation: ["Exhibit 21 subsidiary list"] },
    });

const apple: AnalysisEnvelope = {
  ticker: "AAPL",
  cik: "0000320193",
  companyName: "Apple Inc.",
  marketPrice: { value: 112.4, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: appleFiling.form,
    accessionNumber: appleFiling.accessionNumber,
    filingDate: appleFiling.filingDate,
    periodOfReport: appleFiling.periodOfReport,
    documentUrl: documentUrl("0000320193", appleFiling),
    filingIndexUrl: filingIndexUrl("0000320193", appleFiling),
  },
  annualReportUrl: "https://investor.apple.com/investor-relations/default.aspx",
  secRetrievedAt: RETRIEVED_AT,
  dataFreshness: {
    secRetrievedAt: RETRIEVED_AT,
    marketPriceAsOf: "2026-08-28T20:00:00Z",
    latestFiscalPeriodEnd: appleFiling.periodOfReport,
    cachePolicy: "SEC company facts are cached for 6 hours; the market quote is delayed and cached for 15 minutes.",
  },
  missingMetrics: [],
  normalizationWarnings: [],
  facts: appleFactData.facts,
  evidence: appleFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "Spare cash keeps growing at roughly 9% a year for the next five years, then slows to about 5%.", evidenceIds: [evidenceId("0000320193", appleFiling, "Calculated")] },
      { statement: "The company keeps turning about a quarter of every sales dollar into profit.", evidenceIds: [evidenceId("0000320193", appleFiling, "NetIncomeLoss")] },
      { statement: "Nothing forces the company to pay a much higher return to its lenders and owners than it does today.", evidenceIds: [] },
    ],
    whatSupports: [
      { statement: "The company brought in more cash than it spent in every one of the last five years.", evidenceIds: [evidenceId("0000320193", appleFiling, "NetCashProvidedByUsedInOperatingActivities")] },
      { statement: "It keeps 47 cents of every sales dollar after the cost of making the product, which is unusually high.", evidenceIds: [evidenceId("0000320193", appleFiling, "GrossProfit")] },
      { statement: "It spends little on new equipment relative to the cash it generates, so most of that cash is genuinely spare.", evidenceIds: [evidenceId("0000320193", appleFiling, "PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    whatWeakens: [
      { statement: "It owes more than it holds in cash, so some of the value belongs to lenders before it reaches shareholders.", evidenceIds: [evidenceId("0000320193", appleFiling, "LongTermDebtAndFinanceLeaseObligations")] },
      { statement: "Buying back shares has shrunk the owners' stake on paper, which flatters some of the ratios below.", evidenceIds: [evidenceId("0000320193", appleFiling, "StockholdersEquity")] },
    ],
    whatCouldProveItWrong: [
      { statement: "Spare cash stops growing, or falls, for two years running.", evidenceIds: [] },
      { statement: "A change in tax or competition rules takes a lasting bite out of profit in a major market.", evidenceIds: [] },
      { statement: "The return investors demand rises by more than one percentage point and stays there.", evidenceIds: [] },
    ],
  },
  analysis: {
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: {
        sector: "technology",
        sectorDisplayName: "Technology",
        businessType: "product_hardware",
        method: "sic_code_range",
        matchedObservation: "SIC 3571 — Electronic Computers",
        confidence: 0.95,
      },
      assumptions: appleBaselineAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", {
          finalBaseline: 0.0967,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "stage_one_growth", value: 0.09 },
          companyModifiers: [
            { name: "normalized_fcf_growth", value: 0.012, rationale: "Five years of free cash flow grew faster than the sector starting point." },
            { name: "maturity_discount", value: -0.005, rationale: "A company of this size and age is unlikely to sustain the sector's younger growth rate." },
          ],
          boundsApplied: [{ name: "stage_one_growth_bound", lower: 0, upper: 0.2, inputValue: 0.097, outputValue: 0.0967, wasApplied: false }],
          dataCoverageConfidence: 0.95,
          stabilityConfidence: 0.86,
          plainEnglishExplanation: "We start from what companies in this sector typically grow at, then nudge it using this company's own record.",
          technicalExplanation: "Weighted blend of normalized free-cash-flow growth, revenue growth, and the sector prior, bounded to [0.00, 0.20].",
          evidenceIds: [evidenceId("0000320193", appleFiling, "Calculated")],
        }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", {
          finalBaseline: 0.0567,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "stage_two_fade_fraction", value: 0.55 },
          plainEnglishExplanation: "Growth fades toward the long-run rate instead of staying high forever.",
          technicalExplanation: "Stage-one rate faded 55% of the way to the terminal rate.",
          dataCoverageConfidence: 0.95,
          stabilityConfidence: 0.86,
        }),
        trace("terminal_growth_rate", "Growth after year 10", {
          finalBaseline: 0.03,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "terminal_growth", value: 0.03 },
          boundsApplied: [{ name: "terminal_growth_bound", lower: 0, upper: 0.035, inputValue: 0.03, outputValue: 0.03, wasApplied: false }],
          plainEnglishExplanation: "After year ten we assume the company grows about as fast as the economy, and no faster.",
          technicalExplanation: "Sector terminal prior held below the discount rate and capped at 3.5%.",
          dataCoverageConfidence: 1,
          stabilityConfidence: 1,
        }),
        trace("discount_rate", "Return investors require", {
          finalBaseline: 0.1315,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "discount_rate", value: 0.125 },
          companyModifiers: [
            { name: "leverage_modifier", value: 0.004, rationale: "Net debt raises the return lenders and owners require." },
            { name: "cash_flow_stability_modifier", value: 0.0025, rationale: "One down year in the five-year cash-flow record." },
          ],
          plainEnglishExplanation: "This is the yearly return an investor would demand for taking this risk. A higher number makes future cash worth less today.",
          technicalExplanation: "Sector discount prior adjusted by deterministic leverage and stability modifiers, bounded to [0.06, 0.20].",
          dataCoverageConfidence: 0.9,
          stabilityConfidence: 0.86,
          evidenceIds: [evidenceId("0000320193", appleFiling, "LongTermDebtAndFinanceLeaseObligations")],
        }),
      ],
    },
    baselineValuation: appleBaselineValuation,
    deterministicChecklist: appleChecklist,
    adjustments: appleAdjustments,
    finalAssumptions: appleFinalAssumptions,
    finalValuation: appleFinalValuation,
    valuationImpact: {
      baselineIntrinsicValuePerShare: appleBaselineValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: appleFinalValuation.intrinsicValuePerShare,
      absoluteChangePerShare:
        appleFinalValuation.intrinsicValuePerShare - appleBaselineValuation.intrinsicValuePerShare,
      relativeChange:
        appleFinalValuation.intrinsicValuePerShare / appleBaselineValuation.intrinsicValuePerShare - 1,
    },
    evidenceAssessment: [
      { statement: "Free cash flow is positive in each of the five retrieved annual periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [evidenceId("0000320193", appleFiling, "Calculated")] },
      { statement: "Gross margin above 45% indicates pricing power that has persisted across the retrieved periods.", claimType: "INTERPRETATION", support: "SUPPORTED", evidenceIds: [evidenceId("0000320193", appleFiling, "GrossProfit")] },
      { statement: "Concentrated supplier and regulatory exposure justifies trimming near-term growth.", claimType: "ASSUMPTION", support: "PARTIALLY_SUPPORTED", evidenceIds: [evidenceId("0000320193", appleFiling, "RevenueFromContractWithCustomerExcludingAssessedTax")] },
      { statement: "Net debt is modest relative to annual free cash flow.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [evidenceId("0000320193", appleFiling, "LongTermDebtAndFinanceLeaseObligations"), evidenceId("0000320193", appleFiling, "CashCashEquivalentsAndShortTermInvestments")] },
    ],
    confidence: confidence("Medium", [
      factor("data_coverage", 0.95, "Every input the baseline needs was found in the filing."),
      factor("cash_flow_stability", 0.86, "One down year in five, otherwise a rising series."),
      factor("sensitivity", 0.58, "A one-point move in the assumptions changes the estimate noticeably."),
      factor("terminal_value_concentration", 0.57, "A meaningful share of the value sits after year ten."),
      factor("evidence_support", 0.88, "Three of four written claims are fully backed by a filing."),
      factor("ai_deterministic_disagreement", 0.85, "One small assumption change, no checklist disagreements."),
    ]),
    checklistQualitativeFindings: appleChecklist.map((result) => ({
      checklistNumber: result.checklistNumber,
      checklistText: result.checklistText,
      status: result.status,
      explanation:
        result.status === "UNKNOWN"
          ? "The written review could not answer this from the retrieved evidence either, and did not guess."
          : "The written review read the filing text and reached the same conclusion as the reported numbers.",
      evidenceIds: [],
      claimType: "INTERPRETATION" as const,
    })),
    disagreement: {
      summary: "The written review and the reported numbers reached the same conclusion on every checklist point.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  methodologyVersion: "dcflens-methodology-2026.02",
  analysisVersion: "analysis-2026.08.28-1",
};

// ---------------------------------------------------------------------------
// Variant helper
//
// The remaining scenarios exist to exercise view states, so they reuse the
// Apple envelope's structure and override only what the state needs. Checklist
// wording and order are never part of an override.
// ---------------------------------------------------------------------------

function restatus(
  base: ChecklistResult[],
  overrides: Record<number, Partial<Omit<ChecklistResult, "checklistNumber" | "checklistText">>>,
): ChecklistResult[] {
  const results = base.map((result) => ({
    ...result,
    // Citations and metrics belong to the filing the base came from, so they
    // are dropped unless the override restates them for this company.
    evidenceIds: [],
    metricsUsed: [],
    ...overrides[result.checklistNumber],
  }));
  assertOriginalContract(results.map((result) => ({ number: result.checklistNumber, text: result.checklistText })));
  return results;
}

// ---------------------------------------------------------------------------
// Scenario 2 — Microsoft: the clean case. Nothing fragile, nothing missing,
// no disagreement. This is the only fixture allowed to read as supporting.
// ---------------------------------------------------------------------------

const microsoftFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0000950170-25-100235",
  filingDate: "2025-07-30",
  periodOfReport: "2025-06-30",
  document: "msft-20250630.htm",
  fiscalYear: 2025,
};

const microsoftFactData = buildFacts("0000789019", microsoftFiling, [
  { metric: "revenue", label: "Revenue", value: 281_724_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 195_000_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: 101_832_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 136_162_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 64_600_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 71_562_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow minus absolute capital expenditure for the same period" },
  { metric: "total_debt", label: "Total debt", value: 60_600_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 94_600_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 343_479_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 7_469_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const microsoftAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.085,
  stageTwoGrowthRate: 0.05,
  terminalGrowthRate: 0.025,
  discountRate: 0.145,
};

const microsoftValuation = buildDcfValuation({
  startingFreeCashFlow: 71_562_000_000,
  netDebt: 60_600_000_000 - 94_600_000_000,
  dilutedShares: 7_469_000_000,
  currency: "USD",
  assumptions: microsoftAssumptions,
  growthRateDelta: 0.005,
  discountRateDelta: 0.005,
  historicalFreeCashFlows: [
    56_118_000_000, 59_475_000_000, 63_333_000_000, 67_012_000_000, 71_562_000_000,
  ],
});

const msftEvidence = (concept: string) => evidenceId("0000789019", microsoftFiling, concept);

const microsoftChecklist = restatus(apple.analysis.deterministicChecklist, {
      2: { status: "SUPPORTS", plainEnglishExplanation: "Sales and gross profit grew at almost the same pace across both comparable years.", missingInformation: [] },
      4: { status: "SUPPORTS", plainEnglishExplanation: "The company holds $94.6bn of cash against $60.6bn of debt, so it owes nothing on a net basis.", technicalExplanation: "Net debt is negative at −$34.0bn." },
      5: { status: "NOT_APPLICABLE", plainEnglishExplanation: "This check is aimed at manufacturers. A software and services business holds no meaningful inventory.", applicabilityReason: "Inventory is immaterial for this business model.", sectorContext: "A software and services business carries no physical inventory by design.", potentialValuationRelevance: "No working-capital inference is drawn where there is no inventory to read." },
      8: { status: "SUPPORTS", plainEnglishExplanation: "The company earns 29.6% on the money owners have left in the business, above the 25% mark, and without a shrunken equity base distorting it.", technicalExplanation: "Net income / stockholders' equity = 29.6%.", sectorContext: "Buybacks lift this ratio across large technology issuers; here the equity base has not been shrunk to the point of distortion.", potentialValuationRelevance: "A genuine return above the threshold supports the reinvestment the growth assumption depends on." },
      9: { status: "SUPPORTS", plainEnglishExplanation: "The company reports three business segments, which is within the simple range this check looks for.", technicalExplanation: "Segment note reports three reportable segments.", missingInformation: [], evidenceIds: [msftEvidence("RevenueFromContractWithCustomerExcludingAssessedTax")] },
      10: { status: "SUPPORTS", plainEnglishExplanation: "The subsidiary list is long but ordinary for a company operating in this many countries, and nothing in it suggests value being routed away from shareholders.", technicalExplanation: "Exhibit 21 lists subsidiaries consistent with the disclosed geographic footprint.", missingInformation: [] },
    });

const microsoft: AnalysisEnvelope = {
  ...apple,
  ticker: "MSFT",
  cik: "0000789019",
  companyName: "Microsoft Corporation",
  marketPrice: { value: 118.9, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: microsoftFiling.form,
    accessionNumber: microsoftFiling.accessionNumber,
    filingDate: microsoftFiling.filingDate,
    periodOfReport: microsoftFiling.periodOfReport,
    documentUrl: documentUrl("0000789019", microsoftFiling),
    filingIndexUrl: filingIndexUrl("0000789019", microsoftFiling),
  },
  annualReportUrl: "https://www.microsoft.com/investor/reports/ar25/index.html",
  dataFreshness: {
    ...apple.dataFreshness,
    latestFiscalPeriodEnd: microsoftFiling.periodOfReport,
  },
  facts: microsoftFactData.facts,
  evidence: microsoftFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "Spare cash keeps growing at about 8.5% a year for five years, then slows to 5%.", evidenceIds: [msftEvidence("Calculated")] },
      { statement: "Heavy spending on data centres keeps paying for itself rather than eating the cash it generates.", evidenceIds: [msftEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    whatSupports: [
      { statement: "Spare cash rose in every one of the last five years, without a single down year.", evidenceIds: [msftEvidence("Calculated")] },
      { statement: "The company holds more cash than it owes, so no value leaks to lenders before it reaches shareholders.", evidenceIds: [msftEvidence("CashCashEquivalentsAndShortTermInvestments")] },
      { statement: "It keeps 69 cents of every sales dollar after the direct cost of delivering the product.", evidenceIds: [msftEvidence("GrossProfit")] },
    ],
    whatWeakens: [
      { statement: "Spending on new equipment has grown much faster than sales, which holds spare cash back.", evidenceIds: [msftEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    whatCouldProveItWrong: [
      { statement: "Data-centre spending keeps rising while sales growth slows.", evidenceIds: [] },
      { statement: "Spare cash falls in any single year over the next three.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: {
        sector: "technology",
        sectorDisplayName: "Technology",
        businessType: "software_and_services",
        method: "sic_code_range",
        matchedObservation: "SIC 7372 — Prepackaged Software",
        confidence: 0.97,
      },
      assumptions: microsoftAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", {
          finalBaseline: 0.085,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "stage_one_growth", value: 0.09 },
          companyModifiers: [{ name: "maturity_discount", value: -0.005, rationale: "Scale makes the sector's younger growth rate unlikely to persist." }],
          dataCoverageConfidence: 0.98,
          stabilityConfidence: 0.96,
          plainEnglishExplanation: "The sector starting point, trimmed a little because a company this large rarely grows as fast as a young one.",
          technicalExplanation: "Sector prior with a single bounded maturity modifier; no fallbacks used.",
          evidenceIds: [msftEvidence("Calculated")],
        }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.05, plainEnglishExplanation: "Growth fades toward the long-run rate.", technicalExplanation: "Stage-one rate faded 58% of the way to the terminal rate.", dataCoverageConfidence: 0.98, stabilityConfidence: 0.96 }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.025, plainEnglishExplanation: "After year ten the company is assumed to grow roughly with the economy.", technicalExplanation: "Sector terminal prior, held well below the discount rate.", dataCoverageConfidence: 1, stabilityConfidence: 1 }),
        trace("discount_rate", "Return investors require", {
          finalBaseline: 0.145,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "discount_rate", value: 0.145 },
          plainEnglishExplanation: "The yearly return an investor would demand for this risk. No company-specific penalty applied: the company holds net cash and its cash record is steady.",
          technicalExplanation: "Sector discount prior with no leverage or stability modifiers triggered.",
          dataCoverageConfidence: 0.98,
          stabilityConfidence: 0.96,
        }),
      ],
    },
    baselineValuation: microsoftValuation,
    finalValuation: microsoftValuation,
    finalAssumptions: microsoftAssumptions,
    adjustments: [],
    valuationImpact: {
      baselineIntrinsicValuePerShare: microsoftValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: microsoftValuation.intrinsicValuePerShare,
      absoluteChangePerShare: 0,
      relativeChange: 0,
    },
    deterministicChecklist: microsoftChecklist,
    evidenceAssessment: [
      { statement: "Free cash flow rose in each of the five retrieved annual periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [msftEvidence("Calculated")] },
      { statement: "The company holds a net cash position at the fiscal period end.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [msftEvidence("CashCashEquivalentsAndShortTermInvestments"), msftEvidence("LongTermDebtAndFinanceLeaseObligations")] },
      { statement: "Capital expenditure grew faster than revenue across the retrieved periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [msftEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    confidence: confidence("High", [
      factor("data_coverage", 0.98, "Every input the baseline needs was found in the filing."),
      factor("cash_flow_stability", 0.96, "Five consecutive years of rising free cash flow."),
      factor("sensitivity", 0.82, "A half-point move in the assumptions changes the estimate modestly."),
      factor("terminal_value_concentration", 0.78, "Under three quarters of the value sits after year ten."),
      factor("evidence_support", 1, "Every written claim points at a filing you can open."),
      factor("ai_deterministic_disagreement", 1, "No assumption changes and no checklist disagreements."),
    ]),
    checklistQualitativeFindings: microsoftChecklist.map((result) => ({
      checklistNumber: result.checklistNumber,
      checklistText: result.checklistText,
      status: result.status,
      explanation: "The written review read the filing text and reached the same conclusion as the reported numbers.",
      evidenceIds: [msftEvidence("Calculated")],
      claimType: "INTERPRETATION" as const,
    })),
    disagreement: {
      summary: "The written review and the reported numbers reached the same conclusion on every checklist point.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  analysisVersion: "analysis-2026.08.28-2",
};

// ---------------------------------------------------------------------------
// Scenario 3 — Intel: the required disagreement. The price sits below the
// range, but the reasoning behind the range is fragile.
// ---------------------------------------------------------------------------

const intelFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0000050863-25-000009",
  filingDate: "2025-01-31",
  periodOfReport: "2024-12-28",
  document: "intc-20241228.htm",
  fiscalYear: 2024,
};

const intelFactData = buildFacts("0000050863", intelFiling, [
  { metric: "revenue", label: "Revenue", value: 53_101_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 17_367_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: -18_756_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 8_288_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 23_944_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 8_500_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "normalized five-year average of operating cash flow minus capital expenditure, used because the latest period is negative" },
  { metric: "total_debt", label: "Total debt", value: 50_020_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 22_060_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 99_270_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 4_300_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const intelAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.04,
  stageTwoGrowthRate: 0.03,
  terminalGrowthRate: 0.025,
  discountRate: 0.085,
};

const intelValuation = buildDcfValuation({
  startingFreeCashFlow: 8_500_000_000,
  netDebt: 50_020_000_000 - 22_060_000_000,
  dilutedShares: 4_300_000_000,
  currency: "USD",
  assumptions: intelAssumptions,
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
  historicalFreeCashFlows: [
    9_100_000_000, 12_800_000_000, -9_600_000_000, -11_900_000_000, -15_700_000_000,
  ],
});

const intcEvidence = (concept: string) => evidenceId("0000050863", intelFiling, concept);

const intelChecklist = restatus(apple.analysis.deterministicChecklist, {
  1: { status: "MONITOR", plainEnglishExplanation: "The company keeps 32.7% of each sales dollar after the direct cost of the product. That clears the 20% mark, but it has fallen for three years running.", technicalExplanation: "Gross profit / revenue = 32.7%, above the 20% threshold but declining across the retrieved periods.", evidenceIds: [intcEvidence("GrossProfit")], sectorContext: "Semiconductor manufacturers commonly report gross margins between 40% and 60%; this figure sits below that band.", potentialValuationRelevance: "A margin below the sector band undermines the assumption that spare cash recovers." },
  2: { status: "WEAKENS", plainEnglishExplanation: "Sales fell while the cost of making the product rose, so gross profit fell much faster than sales did.", technicalExplanation: "Gross-profit growth trails revenue growth by 11.4 percentage points.", missingInformation: [] },
  3: { status: "WEAKENS", plainEnglishExplanation: "The company made a loss, so there are no earnings for each share to be consistent with.", technicalExplanation: "Net income is negative; the EPS-to-profit consistency test is not meaningful against a loss.", sectorContext: "Share-based pay dilutes holders across this sector, and no offsetting buyback ran in the retrieved period.", potentialValuationRelevance: "Dilution would reduce the value reaching each existing share." },
  4: { status: "WEAKENS", plainEnglishExplanation: "The company owes $50.0bn against $22.1bn of cash while its day-to-day cash generation is shrinking.", technicalExplanation: "Net debt is $28.0bn against declining operating cash flow.", sectorContext: "Capital-intensive semiconductor manufacturers commonly carry substantial debt to fund fabrication capacity.", potentialValuationRelevance: "Net debt is subtracted before the per-share figure, and rising debt against falling cash generation compounds that deduction." },
  5: { status: "MONITOR", plainEnglishExplanation: "Inventory grew faster than sales while profit margins fell, which is the pattern this check is designed to catch.", technicalExplanation: "Inventory growth exceeds revenue growth by 8.2 percentage points with a falling PAT margin.", applicabilityReason: "Inventory analysis applies because this sector holds material physical inventory.", sectorContext: "Semiconductor manufacturers carry substantial wafer and finished-goods inventory, so this signal is meaningful here.", potentialValuationRelevance: "Inventory growing faster than sales consumes working capital and reduces future spare cash." },
  6: { status: "UNKNOWN", plainEnglishExplanation: "Money owed by customers is missing from the filing facts, so we cannot tell whether sales are being collected or merely booked.", technicalExplanation: "Receivables are missing, so the sales-versus-receivables comparison has no second series.", missingInformation: ["two annual receivables facts"] },
  7: { status: "SUPPORTS", plainEnglishExplanation: "Day-to-day operations still brought in $8.3bn of cash, even in a loss-making year.", technicalExplanation: "Operating cash flow is positive at $8.3bn.", evidenceIds: [intcEvidence("NetCashProvidedByUsedInOperatingActivities")] },
  8: { status: "WEAKENS", plainEnglishExplanation: "The company lost money, so the return on owners' capital is negative rather than above 25%.", technicalExplanation: "Net income / stockholders' equity = −18.9%.", sectorContext: "A loss makes this ratio negative; no company can meet the threshold in a loss-making year.", potentialValuationRelevance: "A negative return offers no support for the reinvestment the growth assumption depends on." },
});

const intel: AnalysisEnvelope = {
  ...apple,
  ticker: "INTC",
  cik: "0000050863",
  companyName: "Intel Corporation",
  marketPrice: { value: 19.42, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: intelFiling.form,
    accessionNumber: intelFiling.accessionNumber,
    filingDate: intelFiling.filingDate,
    periodOfReport: intelFiling.periodOfReport,
    documentUrl: documentUrl("0000050863", intelFiling),
    filingIndexUrl: filingIndexUrl("0000050863", intelFiling),
  },
  annualReportUrl: "https://www.intc.com/financial-info/annual-reports-and-proxy",
  dataFreshness: { ...apple.dataFreshness, latestFiscalPeriodEnd: intelFiling.periodOfReport },
  missingMetrics: ["receivables"],
  normalizationWarnings: [
    { code: "missing_metric", metric: "receivables", fiscalYear: null, message: "No eligible annual receivables fact exists under the configured concepts." },
    { code: "restated_fact_selected", metric: "operating_cash_flow", fiscalYear: 2023, message: "Two values were reported for FY2023; the later-filed value was selected." },
  ],
  facts: intelFactData.facts,
  evidence: intelFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "The company returns to generating spare cash, having burned cash in each of the last three years.", evidenceIds: [intcEvidence("Calculated")] },
      { statement: "The heavy factory spending of the last three years starts producing sales rather than only costs.", evidenceIds: [intcEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
      { statement: "The share of each sales dollar kept after production costs stops falling.", evidenceIds: [intcEvidence("GrossProfit")] },
    ],
    whatSupports: [
      { statement: "Day-to-day operations still brought in $8.3bn of cash even in a loss-making year.", evidenceIds: [intcEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      { statement: "The company still owns a large base of factories and equipment against its debts.", evidenceIds: [intcEvidence("StockholdersEquity")] },
    ],
    whatWeakens: [
      { statement: "The company spent $23.9bn on new equipment against $8.3bn of cash from operations, so it burned cash overall.", evidenceIds: [intcEvidence("PaymentsToAcquirePropertyPlantAndEquipment"), intcEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      { statement: "It reported a loss of $18.8bn for the year.", evidenceIds: [intcEvidence("NetIncomeLoss")] },
      { statement: "It owes $50.0bn against $22.1bn of cash.", evidenceIds: [intcEvidence("LongTermDebtAndFinanceLeaseObligations")] },
      { statement: "The starting cash figure had to be smoothed over five years because the most recent one was negative. That smoothing is a choice, and it flatters the estimate.", evidenceIds: [intcEvidence("Calculated")] },
    ],
    whatCouldProveItWrong: [
      { statement: "Spare cash stays negative for another two years.", evidenceIds: [] },
      { statement: "The share of each sales dollar kept after production costs falls below 30%.", evidenceIds: [] },
      { statement: "The company has to raise money by selling new shares, splitting the same value across more of them.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: {
        sector: "technology",
        sectorDisplayName: "Technology",
        businessType: "semiconductor_manufacturing",
        method: "sic_code_range",
        matchedObservation: "SIC 3674 — Semiconductors and Related Devices",
        confidence: 0.94,
      },
      assumptions: intelAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", {
          finalBaseline: 0.04,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "stage_one_growth", value: 0.09 },
          companyModifiers: [{ name: "negative_history_modifier", value: -0.05, rationale: "Three consecutive years of negative free cash flow pull the growth assumption down to the floor." }],
          boundsApplied: [{ name: "stage_one_growth_bound", lower: 0.04, upper: 0.2, inputValue: 0.04, outputValue: 0.04, wasApplied: true }],
          fallbacks: ["normalized_five_year_average_free_cash_flow"],
          dataCoverageConfidence: 0.62,
          stabilityConfidence: 0.18,
          plainEnglishExplanation: "The company's recent record is bad enough that the growth assumption was pushed to the lowest value we allow.",
          technicalExplanation: "Sector prior reduced by a negative-history modifier and then held at the lower bound of 0.04.",
          evidenceIds: [intcEvidence("Calculated")],
        }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.03, dataCoverageConfidence: 0.62, stabilityConfidence: 0.18, plainEnglishExplanation: "Growth fades toward the long-run rate.", technicalExplanation: "Stage-one rate faded 67% of the way to the terminal rate." }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.025, dataCoverageConfidence: 1, stabilityConfidence: 1, plainEnglishExplanation: "After year ten the company is assumed to grow roughly with the economy.", technicalExplanation: "Sector terminal prior held below the discount rate." }),
        trace("discount_rate", "Return investors require", {
          finalBaseline: 0.085,
          sectorPrior: { version: "priors-2026.02", sector: "technology", parameter: "discount_rate", value: 0.125 },
          companyModifiers: [{ name: "asset_backing_modifier", value: -0.04, rationale: "A large owned manufacturing base reduces the modelled required return." }],
          boundsApplied: [{ name: "discount_rate_bound", lower: 0.085, upper: 0.2, inputValue: 0.085, outputValue: 0.085, wasApplied: true }],
          dataCoverageConfidence: 0.62,
          stabilityConfidence: 0.18,
          plainEnglishExplanation: "The required return sits at the lowest value we allow. That is doing a lot of the work in this estimate, and it deserves scrutiny.",
          technicalExplanation: "Sector prior reduced by an asset-backing modifier and then held at the lower bound of 0.085.",
          evidenceIds: [intcEvidence("StockholdersEquity")],
        }),
      ],
    },
    baselineValuation: intelValuation,
    finalValuation: intelValuation,
    finalAssumptions: intelAssumptions,
    adjustments: [],
    valuationImpact: {
      baselineIntrinsicValuePerShare: intelValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: intelValuation.intrinsicValuePerShare,
      absoluteChangePerShare: 0,
      relativeChange: 0,
    },
    deterministicChecklist: intelChecklist,
    evidenceAssessment: [
      { statement: "Free cash flow was negative in each of the three most recent annual periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [intcEvidence("Calculated")] },
      { statement: "Capital expenditure exceeded operating cash flow in the latest period.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [intcEvidence("PaymentsToAcquirePropertyPlantAndEquipment"), intcEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      { statement: "The current factory investment programme will restore free cash flow within two years.", claimType: "INTERPRETATION", support: "UNSUPPORTED", evidenceIds: [] },
      { statement: "Gross margin decline reflects a temporary product transition rather than lasting competitive loss.", claimType: "INTERPRETATION", support: "UNSUPPORTED", evidenceIds: [] },
      { statement: "Receivables collection has deteriorated.", claimType: "FACT", support: "CONTRADICTED", evidenceIds: [intcEvidence("RevenueFromContractWithCustomerExcludingAssessedTax")] },
    ],
    confidence: confidence("Low", [
      factor("data_coverage", 0.62, "One metric the checklist normally uses is missing from the filing."),
      factor("cash_flow_stability", 0.18, "Free cash flow changed sign during the retrieved history."),
      factor("sensitivity", 0.24, "A one-point move in the assumptions changes the estimate dramatically."),
      factor("terminal_value_concentration", 0.38, "Much of the value sits after year ten."),
      factor("evidence_support", 0.4, "Two claims are unbacked and one is contradicted by the filing."),
      factor("ai_deterministic_disagreement", 0.55, "The written review disagreed with the reported numbers on two checklist points."),
    ]),
    checklistQualitativeFindings: [
      { checklistNumber: 1, checklistText: ORIGINAL_CHECKLIST[0].text, status: "WEAKENS", explanation: "The written review reads the three-year margin decline as evidence that the moat is eroding, not merely something to watch.", evidenceIds: [intcEvidence("GrossProfit")], claimType: "INTERPRETATION" },
      { checklistNumber: 4, checklistText: ORIGINAL_CHECKLIST[3].text, status: "MONITOR", explanation: "The written review treats the debt as manageable against the owned asset base; the reported numbers treat it as a weakness.", evidenceIds: [intcEvidence("StockholdersEquity")], claimType: "INTERPRETATION" },
      { checklistNumber: 5, checklistText: ORIGINAL_CHECKLIST[4].text, status: "MONITOR", explanation: "The written review agrees that inventory growth ahead of sales is worth watching.", evidenceIds: [], claimType: "INTERPRETATION" },
      { checklistNumber: 7, checklistText: ORIGINAL_CHECKLIST[6].text, status: "SUPPORTS", explanation: "The written review agrees that operating cash flow remains positive.", evidenceIds: [intcEvidence("NetCashProvidedByUsedInOperatingActivities")], claimType: "FACT" },
      { checklistNumber: 8, checklistText: ORIGINAL_CHECKLIST[7].text, status: "WEAKENS", explanation: "The written review agrees that a loss cannot produce a return above 25%.", evidenceIds: [intcEvidence("NetIncomeLoss")], claimType: "FACT" },
      { checklistNumber: 2, checklistText: ORIGINAL_CHECKLIST[1].text, status: "WEAKENS", explanation: "The written review agrees that gross profit fell faster than sales.", evidenceIds: [], claimType: "INTERPRETATION" },
      { checklistNumber: 3, checklistText: ORIGINAL_CHECKLIST[2].text, status: "WEAKENS", explanation: "The written review agrees that a loss leaves nothing for earnings per share to track.", evidenceIds: [], claimType: "FACT" },
      { checklistNumber: 6, checklistText: ORIGINAL_CHECKLIST[5].text, status: "UNKNOWN", explanation: "Receivables are missing from the filing facts, so no collection conclusion is drawn.", evidenceIds: [], claimType: "INTERPRETATION" },
      { checklistNumber: 9, checklistText: ORIGINAL_CHECKLIST[8].text, status: "UNKNOWN", explanation: "No business-line evidence was retrieved.", evidenceIds: [], claimType: "INTERPRETATION" },
      { checklistNumber: 10, checklistText: ORIGINAL_CHECKLIST[9].text, status: "UNKNOWN", explanation: "No subsidiary list was retrieved.", evidenceIds: [], claimType: "INTERPRETATION" },
    ],
    disagreement: {
      summary:
        "The written review and the reported numbers reached different conclusions on two of the ten checks. Both readings are shown; neither has been merged into a single score.",
      checklistDisagreements: [
        { checklistNumber: 1, checklistText: ORIGINAL_CHECKLIST[0].text, deterministicStatus: "MONITOR", aiStatus: "WEAKENS", evidenceIds: [intcEvidence("GrossProfit")] },
        { checklistNumber: 4, checklistText: ORIGINAL_CHECKLIST[3].text, deterministicStatus: "WEAKENS", aiStatus: "MONITOR", evidenceIds: [intcEvidence("StockholdersEquity")] },
      ],
      evidenceIds: [intcEvidence("GrossProfit"), intcEvidence("StockholdersEquity")],
    },
  },
  analysisVersion: "analysis-2026.08.28-3",
};

// ---------------------------------------------------------------------------
// Scenario 4 — Warner Bros. Discovery: the calculation completes and returns a
// negative value per share. We say so rather than hiding the result.
// ---------------------------------------------------------------------------

const wbdFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0001437107-25-000012",
  filingDate: "2025-02-27",
  periodOfReport: "2024-12-31",
  document: "wbd-20241231.htm",
  fiscalYear: 2024,
};

const wbdFactData = buildFacts("0001437107", wbdFiling, [
  { metric: "revenue", label: "Revenue", value: 39_321_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 15_040_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: -11_313_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 5_376_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 2_976_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 2_400_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow minus absolute capital expenditure for the same period" },
  { metric: "total_debt", label: "Total debt", value: 40_100_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 5_500_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 2_460_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const wbdAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.01,
  stageTwoGrowthRate: 0.01,
  terminalGrowthRate: 0.02,
  discountRate: 0.115,
};

const wbdValuation = buildDcfValuation({
  startingFreeCashFlow: 2_400_000_000,
  netDebt: 40_100_000_000 - 5_500_000_000,
  dilutedShares: 2_460_000_000,
  currency: "USD",
  assumptions: wbdAssumptions,
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
  historicalFreeCashFlows: [3_310_000_000, 6_160_000_000, 4_390_000_000, 2_400_000_000],
});

const wbdEvidence = (concept: string) => evidenceId("0001437107", wbdFiling, concept);

const wbdChecklist = restatus(apple.analysis.deterministicChecklist, {
      1: { status: "SUPPORTS", plainEnglishExplanation: "The company keeps 38.2% of each sales dollar after direct costs, above the 20% mark.", evidenceIds: [wbdEvidence("GrossProfit")], sectorContext: "Media businesses commonly report gross margins between 30% and 45%.", potentialValuationRelevance: "A durable margin supports the assumption that spare cash holds up while debt is repaid." },
      2: { status: "WEAKENS", plainEnglishExplanation: "Sales fell while gross profit fell faster.", missingInformation: [], sectorContext: "Media revenue mix shifts between advertising, distribution and content licensing can move gross profit away from revenue.", potentialValuationRelevance: "Persistent divergence would undermine the growth assumption." },
      3: { status: "WEAKENS", plainEnglishExplanation: "The company made a loss, so there are no earnings for each share to be consistent with." },
      4: { status: "WEAKENS", plainEnglishExplanation: "The company owes $40.1bn against $5.5bn of cash and $2.4bn of yearly spare cash. This is the single largest problem in the filing.", sectorContext: "Media consolidation in this sector was largely debt-funded, so heavy leverage is common — which does not make it safe.", potentialValuationRelevance: "Net debt is subtracted from the value of the business, and here it exceeds that value entirely." },
      5: { status: "NOT_APPLICABLE", plainEnglishExplanation: "A media business holds no meaningful physical inventory, so this manufacturing check does not apply.", applicabilityReason: "Inventory is immaterial for this business model.", sectorContext: "A media and entertainment business capitalizes content rather than holding physical inventory.", potentialValuationRelevance: "Content amortization, not inventory, is the relevant working-capital question for this business." },
      6: { status: "MONITOR", plainEnglishExplanation: "Money owed by customers grew slightly faster than sales." },
      7: { status: "SUPPORTS", plainEnglishExplanation: "Day-to-day operations brought in $5.4bn of cash.", evidenceIds: [wbdEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      8: { status: "UNKNOWN", plainEnglishExplanation: "The owners' capital figure is missing from the filing facts, so this return cannot be calculated.", technicalExplanation: "Stockholders' equity is missing; the ratio has no denominator.", missingInformation: ["stockholders' equity for the latest fiscal year"], sectorContext: "Large write-downs can reduce or eliminate reported equity in this sector, which is one reason the figure may be absent.", potentialValuationRelevance: "Without a denominator no return can be computed, and none is assumed." },
    });

const warnerBrosDiscovery: AnalysisEnvelope = {
  ...apple,
  ticker: "WBD",
  cik: "0001437107",
  companyName: "Warner Bros. Discovery, Inc.",
  marketPrice: { value: 11.86, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: wbdFiling.form,
    accessionNumber: wbdFiling.accessionNumber,
    filingDate: wbdFiling.filingDate,
    periodOfReport: wbdFiling.periodOfReport,
    documentUrl: documentUrl("0001437107", wbdFiling),
    filingIndexUrl: filingIndexUrl("0001437107", wbdFiling),
  },
  annualReportUrl: "https://ir.wbd.com/financial-information/annual-reports",
  dataFreshness: { ...apple.dataFreshness, latestFiscalPeriodEnd: wbdFiling.periodOfReport },
  missingMetrics: ["stockholders_equity"],
  normalizationWarnings: [
    { code: "missing_metric", metric: "stockholders_equity", fiscalYear: null, message: "No eligible annual stockholders' equity fact exists under the configured concepts." },
  ],
  facts: wbdFactData.facts,
  evidence: wbdFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "The company keeps generating spare cash while it pays down what it owes.", evidenceIds: [wbdEvidence("Calculated")] },
    ],
    whatSupports: [
      { statement: "Day-to-day operations still brought in $5.4bn of cash.", evidenceIds: [wbdEvidence("NetCashProvidedByUsedInOperatingActivities")] },
    ],
    whatWeakens: [
      { statement: "The company owes $40.1bn against $5.5bn of cash — more than this calculation says the whole business is worth.", evidenceIds: [wbdEvidence("LongTermDebtAndFinanceLeaseObligations")] },
      { statement: "Spare cash has fallen for two years running.", evidenceIds: [wbdEvidence("Calculated")] },
      { statement: "It reported a loss of $11.3bn for the year.", evidenceIds: [wbdEvidence("NetIncomeLoss")] },
    ],
    whatCouldProveItWrong: [
      { statement: "The company sells assets and pays down debt much faster than the calculation assumes.", evidenceIds: [] },
      { statement: "Spare cash returns to the $6bn it reached two years ago.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: { sector: "consumer", sectorDisplayName: "Consumer and media", businessType: "media_and_entertainment", method: "keyword_match", matchedObservation: "Cable and other pay television services", confidence: 0.71 },
      assumptions: wbdAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", { finalBaseline: 0.01, sectorPrior: { version: "priors-2026.02", sector: "consumer", parameter: "stage_one_growth", value: 0.04 }, companyModifiers: [{ name: "declining_fcf_modifier", value: -0.03, rationale: "Two consecutive years of falling free cash flow." }], dataCoverageConfidence: 0.7, stabilityConfidence: 0.35, plainEnglishExplanation: "Barely any growth is assumed, because spare cash has been shrinking.", technicalExplanation: "Sector prior reduced by a declining-cash-flow modifier, bounded to [0.00, 0.15]." }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.01, dataCoverageConfidence: 0.7, stabilityConfidence: 0.35, plainEnglishExplanation: "Growth stays flat in the second stage too.", technicalExplanation: "Stage-one rate carried forward; the fade produces the same value." }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.02, dataCoverageConfidence: 1, stabilityConfidence: 1, plainEnglishExplanation: "After year ten the company is assumed to grow slightly below the economy.", technicalExplanation: "Sector terminal prior held below the discount rate." }),
        trace("discount_rate", "Return investors require", { finalBaseline: 0.115, sectorPrior: { version: "priors-2026.02", sector: "consumer", parameter: "discount_rate", value: 0.095 }, companyModifiers: [{ name: "leverage_modifier", value: 0.02, rationale: "Net debt of $34.6bn against $2.4bn of free cash flow raises the required return." }], dataCoverageConfidence: 0.7, stabilityConfidence: 0.35, plainEnglishExplanation: "A higher return is demanded because the company carries heavy debt against modest cash generation.", technicalExplanation: "Sector prior raised by a bounded leverage modifier.", evidenceIds: [wbdEvidence("LongTermDebtAndFinanceLeaseObligations")] }),
      ],
    },
    baselineValuation: wbdValuation,
    finalValuation: wbdValuation,
    finalAssumptions: wbdAssumptions,
    adjustments: [],
    valuationImpact: {
      baselineIntrinsicValuePerShare: wbdValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: wbdValuation.intrinsicValuePerShare,
      absoluteChangePerShare: 0,
      relativeChange: 0,
    },
    deterministicChecklist: wbdChecklist,
    evidenceAssessment: [
      { statement: "Net debt exceeds the calculated enterprise value.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [wbdEvidence("LongTermDebtAndFinanceLeaseObligations"), wbdEvidence("CashCashEquivalentsAndShortTermInvestments")] },
      { statement: "Free cash flow declined in each of the two most recent annual periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [wbdEvidence("Calculated")] },
      { statement: "Asset disposals will reduce leverage faster than the baseline assumes.", claimType: "INTERPRETATION", support: "UNSUPPORTED", evidenceIds: [] },
    ],
    confidence: confidence("Low", [
      factor("data_coverage", 0.7, "One metric the checklist needs is missing from the filing."),
      factor("cash_flow_stability", 0.35, "Free cash flow has fallen in two consecutive years."),
      factor("sensitivity", 0.2, "The estimate is dominated by debt, so small assumption changes swing it widely."),
      factor("terminal_value_concentration", 0.42, "Much of the enterprise value sits after year ten."),
      factor("evidence_support", 0.67, "Two of three written claims are backed by a filing."),
      factor("ai_deterministic_disagreement", 1, "No assumption changes and no checklist disagreements."),
    ]),
    checklistQualitativeFindings: wbdChecklist.map((result) => ({
      checklistNumber: result.checklistNumber,
      checklistText: result.checklistText,
      status: result.status,
      explanation: "The written review read the filing text and did not contradict the reported numbers on this point.",
      evidenceIds: [],
      claimType: "INTERPRETATION" as const,
    })),
    disagreement: {
      summary: "The written review did not contradict the reported numbers on any checklist point.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  analysisVersion: "analysis-2026.08.28-4",
};

// ---------------------------------------------------------------------------
// Scenario 5 — JPMorgan Chase: no market price, several checks that do not
// apply to a bank, and evidence gaps we state rather than fill in.
// ---------------------------------------------------------------------------

const jpmFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0000019617-25-000239",
  filingDate: "2025-02-14",
  periodOfReport: "2024-12-31",
  document: "jpm-20241231.htm",
  fiscalYear: 2024,
};

const jpmFactData = buildFacts("0000019617", jpmFiling, [
  { metric: "revenue", label: "Total net revenue", value: 177_600_000_000, unit: "USD", concept: "Revenues", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: 58_471_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 41_200_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 41_200_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow with no capital-expenditure deduction, because no eligible capital-expenditure fact exists" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 344_758_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 2_870_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const jpmAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.035,
  stageTwoGrowthRate: 0.028,
  terminalGrowthRate: 0.02,
  discountRate: 0.115,
};

const jpmValuation = buildDcfValuation({
  startingFreeCashFlow: 41_200_000_000,
  netDebt: 0,
  dilutedShares: 2_870_000_000,
  currency: "USD",
  assumptions: jpmAssumptions,
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
});

const jpmEvidence = (concept: string) => evidenceId("0000019617", jpmFiling, concept);

const jpmChecklist = restatus(apple.analysis.deterministicChecklist, {
  1: { status: "NOT_APPLICABLE", plainEnglishExplanation: "This check compares what a company sells against what it costs to make. A bank does not make a product, so the comparison has no meaning here.", technicalExplanation: "Gross profit is not a reported concept for a bank holding company.", applicabilityReason: "Ordinary gross-margin analysis is not applicable to a financial institution.", sectorContext: "Banks report net interest income and provisions rather than cost of goods sold.", potentialValuationRelevance: "Net interest margin and credit quality are the relevant evidence instead; they sit outside this unchanged checklist item.", missingInformation: [], evidenceIds: [] },
  2: { status: "UNKNOWN", plainEnglishExplanation: "We could not compare sales growth against gross profit growth, because a bank reports neither in the form this check expects.", missingInformation: ["gross profit for two comparable annual periods"] },
  3: { status: "SUPPORTS", plainEnglishExplanation: "Earnings for each share moved in line with profit, and the share count fell rather than rose.", evidenceIds: [jpmEvidence("NetIncomeLoss")] },
  4: { status: "NOT_APPLICABLE", plainEnglishExplanation: "Borrowing is how a bank does business, not a warning sign. Judging it by an ordinary company's debt test would be misleading.", technicalExplanation: "Deposits and wholesale funding are operating liabilities for a bank, not leverage in the sense this item tests.", applicabilityReason: "Ordinary leverage analysis is not applicable to a deposit-taking institution.", sectorContext: "Regulatory capital ratios are the relevant measure and are outside this item's ordinary metric.", potentialValuationRelevance: "Capital adequacy, not the debt ratio, governs how much value reaches shareholders." },
  5: { status: "NOT_APPLICABLE", plainEnglishExplanation: "A bank holds no physical inventory, so there is nothing for this manufacturing check to look at.", applicabilityReason: "Inventory is not a reported concept for a bank holding company.", technicalExplanation: "No inventory concept exists in the retrieved company facts." },
  6: { status: "NOT_APPLICABLE", plainEnglishExplanation: "For a bank, money owed by customers is the business itself — loans — not an unpaid bill. Treating loans as slow collections would be wrong.", technicalExplanation: "Loans and financial receivables are core earning assets rather than trade collection balances.", applicabilityReason: "Ordinary sales-versus-receivables analysis is not applicable to a bank.", sectorContext: "Asset quality and loan-loss evidence are required instead.", potentialValuationRelevance: "Credit losses, not collection timing, drive cash available to shareholders." },
  7: { status: "SUPPORTS", plainEnglishExplanation: "Day-to-day operations brought in $41.2bn of cash.", evidenceIds: [jpmEvidence("NetCashProvidedByUsedInOperatingActivities")] },
  8: { status: "WEAKENS", plainEnglishExplanation: "The company earns 17.0% on the money owners have left in the business, below the 25% this check looks for.", technicalExplanation: "Net income / stockholders' equity = 17.0%, below the 25% threshold.", evidenceIds: [jpmEvidence("NetIncomeLoss"), jpmEvidence("StockholdersEquity")], sectorContext: "Bank returns on equity are commonly between 10% and 20% and are constrained by regulatory capital requirements.", potentialValuationRelevance: "Regulatory capital, not this ratio, governs how much value can be distributed to shareholders." },
});

const jpmorgan: AnalysisEnvelope = {
  ...apple,
  ticker: "JPM",
  cik: "0000019617",
  companyName: "JPMorgan Chase & Co.",
  marketPrice: null,
  latestFiling: {
    form: jpmFiling.form,
    accessionNumber: jpmFiling.accessionNumber,
    filingDate: jpmFiling.filingDate,
    periodOfReport: jpmFiling.periodOfReport,
    documentUrl: documentUrl("0000019617", jpmFiling),
    filingIndexUrl: filingIndexUrl("0000019617", jpmFiling),
  },
  annualReportUrl: null,
  dataFreshness: {
    secRetrievedAt: RETRIEVED_AT,
    marketPriceAsOf: null,
    latestFiscalPeriodEnd: jpmFiling.periodOfReport,
    cachePolicy: "SEC company facts are cached for 6 hours. No market quote was retrieved for this issuer.",
  },
  missingMetrics: ["gross_profit", "capital_expenditure", "inventory", "receivables", "total_debt", "cash_and_short_term_investments"],
  normalizationWarnings: [
    { code: "missing_metric", metric: "gross_profit", fiscalYear: null, message: "No eligible annual gross profit fact exists under the configured concepts." },
    { code: "missing_metric", metric: "capital_expenditure", fiscalYear: null, message: "No eligible annual capital expenditure fact exists under the configured concepts." },
    { code: "incomplete_calculation", metric: "free_cash_flow", fiscalYear: 2024, message: "Capital expenditure is absent, so free cash flow was not reduced. The absent component was not treated as zero silently." },
    { code: "missing_metric", metric: "total_debt", fiscalYear: null, message: "No eligible annual total debt fact exists under the configured concepts for this filer." },
    { code: "conflicting_unit_rejected", metric: "revenue", fiscalYear: 2023, message: "Facts reported under a unit other than USD were retained in rejected_facts and excluded." },
  ],
  facts: jpmFactData.facts,
  evidence: jpmFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "The bank keeps earning roughly what it earned last year, growing a little faster than inflation.", evidenceIds: [jpmEvidence("NetIncomeLoss")] },
      { statement: "The cash figure this estimate starts from is a fair stand-in, even though the usual deduction for equipment spending could not be made.", evidenceIds: [jpmEvidence("Calculated")] },
    ],
    whatSupports: [
      { statement: "The bank earned $58.5bn in the year.", evidenceIds: [jpmEvidence("NetIncomeLoss")] },
      { statement: "Day-to-day operations brought in $41.2bn of cash.", evidenceIds: [jpmEvidence("NetCashProvidedByUsedInOperatingActivities")] },
    ],
    whatWeakens: [
      { statement: "Six of the figures this tool normally uses are missing from the filing, so several checks could not be answered.", evidenceIds: [] },
      { statement: "This kind of estimate was built for companies that sell products. A bank's economics do not fit it well.", evidenceIds: [] },
    ],
    whatCouldProveItWrong: [
      { statement: "Loan losses rise sharply, which this estimate does not model at all.", evidenceIds: [] },
      { statement: "Regulators require the bank to hold more capital, leaving less to distribute.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: { sector: "financials", sectorDisplayName: "Financials", businessType: "diversified_bank", method: "sic_code_range", matchedObservation: "SIC 6021 — National Commercial Banks", confidence: 0.98 },
      assumptions: jpmAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", { finalBaseline: 0.035, sectorPrior: { version: "priors-2026.02", sector: "financials", parameter: "stage_one_growth", value: 0.035 }, fallbacks: ["sector_prior_only_no_company_history"], dataCoverageConfidence: 0.4, stabilityConfidence: 0.5, plainEnglishExplanation: "With too little usable history, this falls back entirely to what banks of this kind typically do.", technicalExplanation: "Sector prior used without company modifiers because the free-cash-flow series is incomplete." }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.028, dataCoverageConfidence: 0.4, stabilityConfidence: 0.5, plainEnglishExplanation: "Growth fades toward the long-run rate.", technicalExplanation: "Stage-one rate faded 47% of the way to the terminal rate." }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.02, dataCoverageConfidence: 1, stabilityConfidence: 1, plainEnglishExplanation: "After year ten the bank is assumed to grow slightly below the economy.", technicalExplanation: "Sector terminal prior held below the discount rate." }),
        trace("discount_rate", "Return investors require", { finalBaseline: 0.115, sectorPrior: { version: "priors-2026.02", sector: "financials", parameter: "discount_rate", value: 0.115 }, fallbacks: ["leverage_modifier_unavailable_debt_missing"], dataCoverageConfidence: 0.4, stabilityConfidence: 0.5, plainEnglishExplanation: "The usual debt-based adjustment could not be made, because no usable debt figure was found. The sector figure is used unchanged.", technicalExplanation: "Sector discount prior used without a leverage modifier because total debt is missing." }),
      ],
    },
    baselineValuation: jpmValuation,
    finalValuation: jpmValuation,
    finalAssumptions: jpmAssumptions,
    adjustments: [],
    valuationImpact: {
      baselineIntrinsicValuePerShare: jpmValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: jpmValuation.intrinsicValuePerShare,
      absoluteChangePerShare: 0,
      relativeChange: 0,
    },
    deterministicChecklist: jpmChecklist,
    evidenceAssessment: [
      { statement: "Net income for the fiscal year is $58.5bn.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [jpmEvidence("NetIncomeLoss")] },
      { statement: "Return on equity is below the 25% checklist threshold.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [jpmEvidence("NetIncomeLoss"), jpmEvidence("StockholdersEquity")] },
      { statement: "Credit quality remained stable across the retrieved periods.", claimType: "INTERPRETATION", support: "UNSUPPORTED", evidenceIds: [] },
      { statement: "Capital returns will continue at the current pace.", claimType: "ASSUMPTION", support: "UNSUPPORTED", evidenceIds: [] },
    ],
    confidence: confidence("Low", [
      factor("data_coverage", 0.4, "Six metrics the checklist normally uses are missing from the filing."),
      factor("cash_flow_stability", 0.5, "No usable multi-year free-cash-flow series was available."),
      factor("sensitivity", 0.35, "A one-point move in the assumptions changes the estimate substantially."),
      factor("terminal_value_concentration", 0.34, "Most of the value sits after year ten."),
      factor("evidence_support", 0.5, "Two of four written claims are unbacked."),
      factor("ai_deterministic_disagreement", 1, "No assumption changes and no checklist disagreements."),
    ]),
    checklistQualitativeFindings: jpmChecklist.map((result) => ({
      checklistNumber: result.checklistNumber,
      checklistText: result.checklistText,
      status: result.status,
      explanation:
        result.status === "NOT_APPLICABLE"
          ? "The written review agrees this check does not apply to a bank, and did not substitute a different test in its place."
          : "The written review read the filing text and did not contradict the reported numbers on this point.",
      evidenceIds: [],
      claimType: "INTERPRETATION" as const,
    })),
    disagreement: {
      summary: "The written review did not contradict the reported numbers on any checklist point.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  analysisVersion: "analysis-2026.08.28-5",
};

// ---------------------------------------------------------------------------
// Scenario 6 — Tesla: the model was unavailable. The deterministic result
// still stands on its own, unchanged, and we say what is missing.
// ---------------------------------------------------------------------------

const teslaFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0001628280-25-002135",
  filingDate: "2025-01-30",
  periodOfReport: "2024-12-31",
  document: "tsla-20241231.htm",
  fiscalYear: 2024,
};

const teslaFactData = buildFacts("0001318605", teslaFiling, [
  { metric: "revenue", label: "Revenue", value: 97_690_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 17_450_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: 7_130_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 14_923_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 11_339_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 3_584_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow minus absolute capital expenditure for the same period" },
  { metric: "total_debt", label: "Total debt", value: 7_400_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 36_560_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 72_913_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 3_520_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const teslaAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.14,
  stageTwoGrowthRate: 0.075,
  terminalGrowthRate: 0.03,
  discountRate: 0.155,
};

const teslaValuation = buildDcfValuation({
  startingFreeCashFlow: 3_584_000_000,
  netDebt: 7_400_000_000 - 36_560_000_000,
  dilutedShares: 3_520_000_000,
  currency: "USD",
  assumptions: teslaAssumptions,
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
  historicalFreeCashFlows: [3_483_000_000, 5_030_000_000, 7_566_000_000, 4_357_000_000, 3_584_000_000],
});

const tslaEvidence = (concept: string) => evidenceId("0001318605", teslaFiling, concept);

const tesla: AnalysisEnvelope = {
  ...apple,
  ticker: "TSLA",
  cik: "0001318605",
  companyName: "Tesla, Inc.",
  marketPrice: { value: 331.05, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: teslaFiling.form,
    accessionNumber: teslaFiling.accessionNumber,
    filingDate: teslaFiling.filingDate,
    periodOfReport: teslaFiling.periodOfReport,
    documentUrl: documentUrl("0001318605", teslaFiling),
    filingIndexUrl: filingIndexUrl("0001318605", teslaFiling),
  },
  annualReportUrl: "https://ir.tesla.com/sec-filings",
  dataFreshness: { ...apple.dataFreshness, latestFiscalPeriodEnd: teslaFiling.periodOfReport },
  missingMetrics: [],
  normalizationWarnings: [],
  facts: teslaFactData.facts,
  evidence: teslaFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "Spare cash grows about 14% a year for five years, then slows to about 7.5%.", evidenceIds: [tslaEvidence("Calculated")] },
      { statement: "Heavy factory spending falls back relative to sales, so more of the cash coming in stays in.", evidenceIds: [tslaEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    whatSupports: [
      { statement: "The company holds $36.6bn of cash against $7.4bn of debt.", evidenceIds: [tslaEvidence("CashCashEquivalentsAndShortTermInvestments")] },
      { statement: "Day-to-day operations brought in $14.9bn of cash.", evidenceIds: [tslaEvidence("NetCashProvidedByUsedInOperatingActivities")] },
    ],
    whatWeakens: [
      { statement: "Spare cash has fallen for two years running, from $7.6bn to $3.6bn.", evidenceIds: [tslaEvidence("Calculated")] },
      { statement: "The share of each sales dollar kept after production costs is 17.9%, which is thin for this kind of business.", evidenceIds: [tslaEvidence("GrossProfit")] },
    ],
    whatCouldProveItWrong: [
      { statement: "Spare cash falls for a third year.", evidenceIds: [] },
      { statement: "Price cuts push the share kept after production costs below 15%.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "DETERMINISTIC_FALLBACK",
    fallbackReason: "The Gemini provider returned no response within the configured timeout. The deterministic result is unchanged.",
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: { sector: "industrials", sectorDisplayName: "Industrials", businessType: "vehicle_manufacturing", method: "sic_code_range", matchedObservation: "SIC 3711 — Motor Vehicles and Passenger Car Bodies", confidence: 0.93 },
      assumptions: teslaAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", { finalBaseline: 0.14, sectorPrior: { version: "priors-2026.02", sector: "industrials", parameter: "stage_one_growth", value: 0.05 }, companyModifiers: [{ name: "revenue_growth_modifier", value: 0.09, rationale: "Revenue has grown far faster than the sector across the retrieved periods." }], boundsApplied: [{ name: "stage_one_growth_bound", lower: 0, upper: 0.2, inputValue: 0.14, outputValue: 0.14, wasApplied: false }], dataCoverageConfidence: 0.92, stabilityConfidence: 0.31, plainEnglishExplanation: "Growth well above the sector, because this company has grown much faster than its peers.", technicalExplanation: "Sector prior raised by a bounded revenue-growth modifier." }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.075, dataCoverageConfidence: 0.92, stabilityConfidence: 0.31, plainEnglishExplanation: "Growth fades toward the long-run rate.", technicalExplanation: "Stage-one rate faded 59% of the way to the terminal rate." }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.03, dataCoverageConfidence: 1, stabilityConfidence: 1, plainEnglishExplanation: "After year ten the company is assumed to grow roughly with the economy.", technicalExplanation: "Sector terminal prior capped at 3.5% and held below the discount rate." }),
        trace("discount_rate", "Return investors require", { finalBaseline: 0.155, sectorPrior: { version: "priors-2026.02", sector: "industrials", parameter: "discount_rate", value: 0.12 }, companyModifiers: [{ name: "cash_flow_stability_modifier", value: 0.035, rationale: "Free cash flow fell in two of the retrieved periods." }], dataCoverageConfidence: 0.92, stabilityConfidence: 0.31, plainEnglishExplanation: "A higher return is demanded because the company's spare cash has been erratic.", technicalExplanation: "Sector prior raised by a bounded stability modifier.", evidenceIds: [tslaEvidence("Calculated")] }),
      ],
    },
    baselineValuation: teslaValuation,
    finalValuation: teslaValuation,
    finalAssumptions: teslaAssumptions,
    adjustments: [],
    valuationImpact: {
      baselineIntrinsicValuePerShare: teslaValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: teslaValuation.intrinsicValuePerShare,
      absoluteChangePerShare: 0,
      relativeChange: 0,
    },
    deterministicChecklist: restatus(apple.analysis.deterministicChecklist, {
      1: { status: "MONITOR", plainEnglishExplanation: "The company keeps 17.9% of each sales dollar after direct costs, below the 20% this check looks for.", technicalExplanation: "Gross profit / revenue = 17.9%, below the 20% threshold.", evidenceIds: [tslaEvidence("GrossProfit")], sectorContext: "Vehicle manufacturers commonly report gross margins between 15% and 25%, so this figure is ordinary for the sector even though it fails the check.", potentialValuationRelevance: "A thin margin leaves little room to absorb price competition before spare cash falls." },
      2: { status: "WEAKENS", plainEnglishExplanation: "Sales grew while gross profit fell, so each additional sale is bringing in less.", missingInformation: [], sectorContext: "Price changes move vehicle revenue and gross profit in opposite directions within a single year.", potentialValuationRelevance: "Growth bought with price cuts does not produce the spare cash the estimate assumes." },
      3: { status: "MONITOR", plainEnglishExplanation: "The share count rose slightly, so profit is spread over more shares than last year.", technicalExplanation: "Diluted average shares increased 1.1% year on year.", sectorContext: "Share-based pay is a large component of compensation in this sector and dilutes existing holders.", potentialValuationRelevance: "Dilution reduces the value reaching each existing share." },
      4: { status: "SUPPORTS", plainEnglishExplanation: "The company holds $36.6bn of cash against $7.4bn of debt, so it owes nothing on a net basis.", evidenceIds: [tslaEvidence("CashCashEquivalentsAndShortTermInvestments")], sectorContext: "Vehicle manufacturers commonly carry financing arms and substantial debt; this issuer holds net cash instead.", potentialValuationRelevance: "A net cash position is added to, rather than subtracted from, the value reaching shareholders." },
      5: { status: "MONITOR", plainEnglishExplanation: "Inventory grew faster than sales while margins fell, which is worth watching in a manufacturer.", applicabilityReason: "Inventory analysis applies because this sector holds material physical inventory.", sectorContext: "Vehicle manufacturers carry large finished-goods and parts inventory, so this signal is meaningful here.", potentialValuationRelevance: "Unsold vehicles tie up working capital and invite discounting, both of which reduce future spare cash." },
      7: { status: "SUPPORTS", plainEnglishExplanation: "Day-to-day operations brought in $14.9bn of cash.", evidenceIds: [tslaEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      8: { status: "WEAKENS", plainEnglishExplanation: "The company earns 9.8% on the money owners have left in the business, below the 25% this check looks for.", technicalExplanation: "Net income / stockholders' equity = 9.8%.", sectorContext: "Returns on equity in vehicle manufacturing are commonly well below 25%.", potentialValuationRelevance: "A return below the cost of capital limits how much growth can be funded internally." },
    }),
    evidenceAssessment: [],
    confidence: confidence("Low", [
      factor("data_coverage", 0.92, "Every input the baseline needs was found in the filing."),
      factor("cash_flow_stability", 0.31, "Free cash flow fell in two of the five retrieved periods."),
      factor("sensitivity", 0.29, "A one-point move in the assumptions changes the estimate substantially."),
      factor("terminal_value_concentration", 0.22, "Most of the value sits after year ten."),
      factor("evidence_support", 0, "The written review did not run, so no claim was checked against a filing."),
      factor("ai_deterministic_disagreement", 1, "No assumption changes were proposed."),
    ]),
    checklistQualitativeFindings: [],
    disagreement: {
      summary: "The written review did not run, so there is no second reading to compare the reported numbers against.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  analysisVersion: "analysis-2026.08.28-6",
};

// ---------------------------------------------------------------------------
// Scenario 7 — NIKE: the model came back in part only, and what it did return
// is unusually long. Both are states the page has to survive.
// ---------------------------------------------------------------------------

const nikeFiling: FilingSeed = {
  form: "10-K",
  accessionNumber: "0000320187-25-000045",
  filingDate: "2025-07-24",
  periodOfReport: "2025-05-31",
  document: "nke-20250531.htm",
  fiscalYear: 2025,
};

const nikeFactData = buildFacts("0000320187", nikeFiling, [
  { metric: "revenue", label: "Revenue", value: 46_309_000_000, unit: "USD", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "gross_profit", label: "Gross profit", value: 19_600_000_000, unit: "USD", concept: "GrossProfit", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "net_income", label: "Net income", value: 3_219_000_000, unit: "USD", concept: "NetIncomeLoss", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "operating_cash_flow", label: "Operating cash flow", value: 3_800_000_000, unit: "USD", concept: "NetCashProvidedByUsedInOperatingActivities", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
  { metric: "capital_expenditure", label: "Capital expenditure", value: 800_000_000, unit: "USD", concept: "PaymentsToAcquirePropertyPlantAndEquipment", quality: "reported", transformation: "absolute value of the reported outflow" },
  { metric: "free_cash_flow", label: "Free cash flow", value: 3_000_000_000, unit: "USD", concept: "Calculated", quality: "calculated", transformation: "operating cash flow minus absolute capital expenditure for the same period" },
  { metric: "inventory", label: "Inventory", value: 7_500_000_000, unit: "USD", concept: "InventoryNet", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "total_debt", label: "Total debt", value: 12_100_000_000, unit: "USD", concept: "LongTermDebtAndFinanceLeaseObligations", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "cash_and_short_term_investments", label: "Cash and short-term investments", value: 9_200_000_000, unit: "USD", concept: "CashCashEquivalentsAndShortTermInvestments", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "stockholders_equity", label: "Stockholders' equity", value: 14_600_000_000, unit: "USD", concept: "StockholdersEquity", quality: "reported", transformation: "instant fact at the fiscal period end" },
  { metric: "diluted_average_shares", label: "Diluted average shares", value: 1_480_000_000, unit: "shares", concept: "WeightedAverageNumberOfDilutedSharesOutstanding", quality: "reported", transformation: "annual duration fact selected from the latest 10-K" },
]);

const nikeBaselineAssumptions: DcfAssumptions = {
  stageOneYears: 5,
  stageTwoYears: 5,
  stageOneGrowthRate: 0.045,
  stageTwoGrowthRate: 0.035,
  terminalGrowthRate: 0.025,
  discountRate: 0.105,
};

const nikeAdjustments: AppliedAdjustment[] = [
  {
    assumption: "discount_rate",
    label: "Return investors require",
    baselineAssumption: 0.105,
    aiAdjustment: 0.011,
    finalAssumption: 0.116,
    minimumAdjustment: -0.015,
    maximumAdjustment: 0.015,
    rationale:
      "The filing's risk factors and management discussion describe an inventory correction running across two consecutive years, a shift away from wholesale partners that has not yet been replaced by direct sales at the same volume, and materially higher promotional activity in the two largest regions. Each of these raises the chance that the cash-flow path used here is optimistic, and the written review therefore asked for a higher required return. The request was capped at the maximum allowed adjustment of 1.5 percentage points and applied at 1.1 points. The reported numbers underneath this page were not changed by this request: only the assumption above was moved, and the effect of moving it is shown on its own below.",
    evidenceIds: [evidenceId("0000320187", nikeFiling, "InventoryNet"), evidenceId("0000320187", nikeFiling, "GrossProfit")],
    isolatedIntrinsicValuePerShare: 0,
    isolatedValuationImpactPerShare: 0,
  },
];

const nikeFinalAssumptions = applyAdjustments(nikeBaselineAssumptions, nikeAdjustments);

const nikeDcfBase = {
  startingFreeCashFlow: 3_000_000_000,
  netDebt: 12_100_000_000 - 9_200_000_000,
  dilutedShares: 1_480_000_000,
  currency: "USD",
  growthRateDelta: 0.01,
  discountRateDelta: 0.01,
  historicalFreeCashFlows: [
    5_900_000_000, 5_100_000_000, 6_600_000_000, 4_500_000_000, 3_000_000_000,
  ],
};

const nikeBaselineValuation = buildDcfValuation({ ...nikeDcfBase, assumptions: nikeBaselineAssumptions });
const nikeFinalValuation = buildDcfValuation({ ...nikeDcfBase, assumptions: nikeFinalAssumptions });

nikeAdjustments[0].isolatedIntrinsicValuePerShare = nikeFinalValuation.intrinsicValuePerShare;
nikeAdjustments[0].isolatedValuationImpactPerShare =
  nikeFinalValuation.intrinsicValuePerShare - nikeBaselineValuation.intrinsicValuePerShare;

const nkeEvidence = (concept: string) => evidenceId("0000320187", nikeFiling, concept);

const LONG_CHECKLIST_EXPLANATION =
  "The company keeps 42.3% of every sales dollar after the direct cost of making and shipping the product, which clears the 20% mark this check looks for by a wide margin. That figure alone would read as a strong result, so it is worth being precise about what it does and does not tell you. It has fallen in each of the last three years, from 45.6% to 44.1% to 42.3%, and the filing attributes the decline to higher promotional activity, an unfavourable change in the mix of products sold, and increased freight and logistics costs that were not fully passed on to customers. A margin that clears a threshold while moving steadily toward it is a different piece of evidence from one that clears it and stays put, and this check reports the level rather than the direction. The direction is what the sensitivity range and the required-return assumption above are attempting to price in, which is why this page shows a status of worth-watching rather than in-the-company's-favour even though the number itself passes. If the decline continues at the pace of the last three years, the figure would fall below the 20% mark in roughly nine years, and well before that point the growth assumptions used in this estimate would need to be revisited from the beginning rather than adjusted.";

const nikeChecklist = restatus(apple.analysis.deterministicChecklist, {
  1: { status: "MONITOR", plainEnglishExplanation: LONG_CHECKLIST_EXPLANATION, technicalExplanation: "Gross profit / revenue = 42.3%, above the 20% threshold but declining across three consecutive retrieved periods.", sectorContext: "Branded apparel and footwear issuers commonly report gross margins between 38% and 48%; a decline within that band is not by itself disqualifying.", potentialValuationRelevance: "A margin trending toward the threshold undermines the assumption that spare cash grows steadily.", evidenceIds: [nkeEvidence("GrossProfit"), nkeEvidence("RevenueFromContractWithCustomerExcludingAssessedTax")] },
  2: { status: "WEAKENS", plainEnglishExplanation: "Sales fell 9.8% while gross profit fell 13.4%, so profit fell faster than sales did.", missingInformation: [], sectorContext: "A shift between wholesale and direct selling changes revenue and gross profit at different speeds.", potentialValuationRelevance: "Persistent divergence would undermine the growth assumption." },
  3: { status: "SUPPORTS", plainEnglishExplanation: "Earnings for each share fell in line with profit, and the share count fell rather than rose." },
  4: { status: "MONITOR", plainEnglishExplanation: "The company owes $12.1bn against $9.2bn of cash, which is manageable but is a larger balance than it was two years ago.", sectorContext: "Branded consumer issuers commonly carry modest investment-grade debt.", potentialValuationRelevance: "Net debt is subtracted from the value of the business before the per-share figure." },
  5: { status: "WEAKENS", plainEnglishExplanation: "Inventory is 16.2% of sales and grew while sales fell, at the same time as profit margins fell. That is exactly the pattern this check is designed to catch.", technicalExplanation: "Inventory growth exceeds revenue growth by 12.9 percentage points with a falling PAT margin.", applicabilityReason: "Inventory analysis applies because this business holds material physical inventory.", evidenceIds: [nkeEvidence("InventoryNet")] },
  6: { status: "MONITOR", plainEnglishExplanation: "Money owed by customers grew faster than sales, which is worth watching during a shift toward selling direct." },
  7: { status: "SUPPORTS", plainEnglishExplanation: "Day-to-day operations brought in $3.8bn of cash.", evidenceIds: [nkeEvidence("NetCashProvidedByUsedInOperatingActivities")] },
  8: { status: "WEAKENS", plainEnglishExplanation: "The company earns 22.0% on the money owners have left in the business, just below the 25% this check looks for.", technicalExplanation: "Net income / stockholders' equity = 22.0%.", sectorContext: "Branded consumer issuers commonly report returns on equity between 20% and 40%; buybacks lift the figure by shrinking the base.", potentialValuationRelevance: "A falling return alongside falling spare cash points the same way as the growth assumption being too high." },
});

const nike: AnalysisEnvelope = {
  ...apple,
  ticker: "NKE",
  cik: "0000320187",
  companyName: "NIKE, Inc.",
  marketPrice: { value: 62.4, currency: "USD", asOf: "2026-08-28T20:00:00Z", source: "Illustrative fixture quote" },
  latestFiling: {
    form: nikeFiling.form,
    accessionNumber: nikeFiling.accessionNumber,
    filingDate: nikeFiling.filingDate,
    periodOfReport: nikeFiling.periodOfReport,
    documentUrl: documentUrl("0000320187", nikeFiling),
    filingIndexUrl: filingIndexUrl("0000320187", nikeFiling),
  },
  annualReportUrl: "https://investors.nike.com/investors/news-events-and-reports/",
  dataFreshness: { ...apple.dataFreshness, latestFiscalPeriodEnd: nikeFiling.periodOfReport },
  missingMetrics: [],
  normalizationWarnings: [
    { code: "amended_filing_selected", metric: "gross_profit", fiscalYear: 2024, message: "The selected fact came from a 10-K/A rather than the original 10-K." },
  ],
  facts: nikeFactData.facts,
  evidence: nikeFactData.evidence,
  narrative: {
    whatMustBeTrue: [
      { statement: "Spare cash stops falling and returns to growth of about 4.5% a year, having more than halved over two years.", evidenceIds: [nkeEvidence("Calculated")] },
      { statement: "The build-up of unsold stock clears without the company having to keep discounting to shift it.", evidenceIds: [nkeEvidence("InventoryNet")] },
      { statement: "Selling directly to customers replaces the sales lost from stepping back from wholesale partners.", evidenceIds: [nkeEvidence("RevenueFromContractWithCustomerExcludingAssessedTax")] },
    ],
    whatSupports: [
      { statement: "The company keeps 42.3 cents of every sales dollar after the direct cost of the product.", evidenceIds: [nkeEvidence("GrossProfit")] },
      { statement: "Day-to-day operations still brought in $3.8bn of cash.", evidenceIds: [nkeEvidence("NetCashProvidedByUsedInOperatingActivities")] },
      { statement: "It spends very little on new equipment, so most of the cash it generates is genuinely spare.", evidenceIds: [nkeEvidence("PaymentsToAcquirePropertyPlantAndEquipment")] },
    ],
    whatWeakens: [
      { statement: "Spare cash has fallen from $6.6bn to $3.0bn over two years.", evidenceIds: [nkeEvidence("Calculated")] },
      { statement: "Unsold stock is 16.2% of yearly sales and rose while sales fell.", evidenceIds: [nkeEvidence("InventoryNet")] },
      { statement: "The share of each sales dollar kept after production costs has fallen for three years running.", evidenceIds: [nkeEvidence("GrossProfit")] },
    ],
    whatCouldProveItWrong: [
      { statement: "Spare cash falls for a third year.", evidenceIds: [] },
      { statement: "Unsold stock stays above 15% of sales for another full year.", evidenceIds: [] },
      { statement: "Selling direct turns out to cost more per sale than selling through wholesale partners did.", evidenceIds: [] },
    ],
  },
  analysis: {
    ...apple.analysis,
    status: "APPLIED",
    fallbackReason: null,
    deterministicBaseline: {
      priorVersion: "priors-2026.02",
      classification: { sector: "consumer", sectorDisplayName: "Consumer", businessType: "branded_apparel", method: "sic_code_range", matchedObservation: "SIC 3021 — Rubber and Plastics Footwear", confidence: 0.89 },
      assumptions: nikeBaselineAssumptions,
      traces: [
        trace("stage_one_growth_rate", "Growth in years 1 to 5", { finalBaseline: 0.045, sectorPrior: { version: "priors-2026.02", sector: "consumer", parameter: "stage_one_growth", value: 0.05 }, companyModifiers: [{ name: "declining_fcf_modifier", value: -0.005, rationale: "Free cash flow fell in two consecutive periods." }], dataCoverageConfidence: 0.94, stabilityConfidence: 0.42, plainEnglishExplanation: "Slightly below the sector starting point, because spare cash has been falling.", technicalExplanation: "Sector prior reduced by a bounded declining-cash-flow modifier.", evidenceIds: [nkeEvidence("Calculated")] }),
        trace("stage_two_growth_rate", "Growth in years 6 to 10", { finalBaseline: 0.035, dataCoverageConfidence: 0.94, stabilityConfidence: 0.42, plainEnglishExplanation: "Growth fades toward the long-run rate.", technicalExplanation: "Stage-one rate faded 50% of the way to the terminal rate." }),
        trace("terminal_growth_rate", "Growth after year 10", { finalBaseline: 0.025, dataCoverageConfidence: 1, stabilityConfidence: 1, plainEnglishExplanation: "After year ten the company is assumed to grow roughly with the economy.", technicalExplanation: "Sector terminal prior held below the discount rate." }),
        trace("discount_rate", "Return investors require", { finalBaseline: 0.105, sectorPrior: { version: "priors-2026.02", sector: "consumer", parameter: "discount_rate", value: 0.095 }, companyModifiers: [{ name: "cash_flow_stability_modifier", value: 0.01, rationale: "Free cash flow fell in two of the retrieved periods." }], dataCoverageConfidence: 0.94, stabilityConfidence: 0.42, plainEnglishExplanation: "A slightly higher return is demanded because spare cash has been unsteady.", technicalExplanation: "Sector prior raised by a bounded stability modifier." }),
      ],
    },
    baselineValuation: nikeBaselineValuation,
    finalValuation: nikeFinalValuation,
    finalAssumptions: nikeFinalAssumptions,
    adjustments: nikeAdjustments,
    valuationImpact: {
      baselineIntrinsicValuePerShare: nikeBaselineValuation.intrinsicValuePerShare,
      finalIntrinsicValuePerShare: nikeFinalValuation.intrinsicValuePerShare,
      absoluteChangePerShare: nikeFinalValuation.intrinsicValuePerShare - nikeBaselineValuation.intrinsicValuePerShare,
      relativeChange: nikeFinalValuation.intrinsicValuePerShare / nikeBaselineValuation.intrinsicValuePerShare - 1,
    },
    deterministicChecklist: nikeChecklist,
    evidenceAssessment: [
      { statement: "Free cash flow declined in each of the two most recent annual periods.", claimType: "FACT", support: "SUPPORTED", evidenceIds: [nkeEvidence("Calculated")] },
      { statement: "Inventory rose while revenue fell in the latest period, and inventory now stands at 16.2% of annual revenue, a level the company has reached only once in the retrieved history. Read alongside the three-year gross-margin decline, this is consistent with stock being cleared through discounting rather than through demand, though the retrieved facts do not separate the two.", claimType: "INTERPRETATION", support: "PARTIALLY_SUPPORTED", evidenceIds: [nkeEvidence("InventoryNet")] },
      { statement: "The shift toward direct sales will restore gross margin within two years.", claimType: "INTERPRETATION", support: "UNSUPPORTED", evidenceIds: [] },
    ],
    confidence: confidence("Low", [
      factor("data_coverage", 0.94, "Every input the baseline needs was found in the filing."),
      factor("cash_flow_stability", 0.42, "Free cash flow more than halved across two consecutive periods."),
      factor("sensitivity", 0.44, "A one-point move in the assumptions changes the estimate substantially."),
      factor("terminal_value_concentration", 0.3, "Most of the value sits after year ten."),
      factor("evidence_support", 0.5, "One claim is fully backed, one partly, one not at all."),
      factor("ai_deterministic_disagreement", 0.6, "One assumption was moved and part of the review is missing."),
    ]),
    checklistQualitativeFindings: [
      { checklistNumber: 1, checklistText: ORIGINAL_CHECKLIST[0].text, status: "MONITOR", explanation: "The written review agrees the margin clears the threshold but is trending toward it.", evidenceIds: [nkeEvidence("GrossProfit")], claimType: "INTERPRETATION" },
      { checklistNumber: 5, checklistText: ORIGINAL_CHECKLIST[4].text, status: "WEAKENS", explanation: "The written review agrees that inventory growth against falling sales and falling margin is the pattern this check exists to catch.", evidenceIds: [nkeEvidence("InventoryNet")], claimType: "INTERPRETATION" },
      { checklistNumber: 6, checklistText: ORIGINAL_CHECKLIST[5].text, status: "MONITOR", explanation: "The written review agrees that collection timing is worth watching during the channel shift.", evidenceIds: [], claimType: "INTERPRETATION" },
      { checklistNumber: 7, checklistText: ORIGINAL_CHECKLIST[6].text, status: "SUPPORTS", explanation: "The written review agrees that operating cash flow is positive.", evidenceIds: [nkeEvidence("NetCashProvidedByUsedInOperatingActivities")], claimType: "FACT" },
    ],
    disagreement: {
      summary: "The written review returned only four of the ten checklist points before the response was cut off. The six it did not reach are shown from the reported numbers alone and have not been filled in.",
      checklistDisagreements: [],
      evidenceIds: [],
    },
  },
  analysisVersion: "analysis-2026.08.28-7",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const analysisFixtures: Record<string, AnalysisEnvelope> = {
  AAPL: apple,
  MSFT: microsoft,
  INTC: intel,
  WBD: warnerBrosDiscovery,
  JPM: jpmorgan,
  TSLA: tesla,
  NKE: nike,
};

/** The scenario each fixture exists to exercise, shown on the fixture index. */
export const fixtureScenarios: { ticker: string; state: string }[] = [
  { ticker: "AAPL", state: "Model applied in full; price sits inside the range" },
  { ticker: "MSFT", state: "Nothing fragile, nothing missing, no disagreement" },
  { ticker: "INTC", state: "Price below the range, but the reasoning is fragile" },
  { ticker: "WBD", state: "The calculation returns a negative value per share" },
  { ticker: "JPM", state: "No market price; checks that do not apply to a bank" },
  { ticker: "TSLA", state: "The written review was unavailable" },
  { ticker: "NKE", state: "Partial written review with very long explanations" },
];

export const fixtureTickers = Object.keys(analysisFixtures);

export function getAnalysisFixture(ticker: string): AnalysisEnvelope | null {
  return analysisFixtures[ticker.trim().toUpperCase()] ?? null;
}

/** The default fixture shown wherever one example is needed. */
export const fixtureAnalysis = apple;
