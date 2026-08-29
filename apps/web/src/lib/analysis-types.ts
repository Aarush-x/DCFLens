/**
 * Mirrors the FastAPI `AnalysisEnvelope` in `apps/api/app/services/analysis.py`,
 * converted to camelCase. The web client renders fixtures shaped like the real
 * response so the two sides can be connected without reshaping the view layer.
 */

export type ChecklistStatus =
  | "SUPPORTS"
  | "WEAKENS"
  | "MONITOR"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export type ClaimType = "FACT" | "INTERPRETATION" | "ASSUMPTION";

export type EvidenceSupport =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "UNSUPPORTED"
  | "CONTRADICTED";

export type ConfidenceLevel = "High" | "Medium" | "Low";

export type AiAnalysisStatus = "APPLIED" | "DETERMINISTIC_FALLBACK";

export interface EvidenceReference {
  evidenceId: string;
  provider: string;
  cik: string;
  accessionNumber: string | null;
  filingForm: string;
  filingDate: string;
  fiscalPeriod: string;
  xbrlConcept: string;
  unit: string;
  rawValue: number;
  normalizedValue: number;
  transformation: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface NormalizedFact {
  metric: string;
  label: string;
  fiscalYear: number;
  fiscalPeriod: string;
  periodEnd: string;
  unit: string;
  value: number;
  /** `reported` for a directly selected SEC fact, `calculated` for a derived one. */
  quality: "reported" | "calculated";
  evidenceIds: string[];
}

export interface NormalizationWarning {
  code: string;
  metric: string | null;
  fiscalYear: number | null;
  message: string;
}

export interface DcfAssumptions {
  stageOneYears: number;
  stageTwoYears: number;
  stageOneGrowthRate: number;
  stageTwoGrowthRate: number;
  terminalGrowthRate: number;
  discountRate: number;
}

export interface PriorReference {
  version: string;
  sector: string;
  parameter: string;
  value: number;
}

export interface CompanyModifier {
  name: string;
  value: number;
  rationale: string;
}

export interface BoundRecord {
  name: string;
  lower: number;
  upper: number;
  inputValue: number;
  outputValue: number;
  wasApplied: boolean;
}

export interface AssumptionTrace {
  assumption: string;
  label: string;
  sectorPrior: PriorReference | null;
  companyModifiers: CompanyModifier[];
  fallbacks: string[];
  boundsApplied: BoundRecord[];
  finalBaseline: number;
  dataCoverageConfidence: number;
  stabilityConfidence: number;
  plainEnglishExplanation: string;
  technicalExplanation: string;
  evidenceIds: string[];
}

export interface CompanyClassification {
  sector: string;
  sectorDisplayName: string;
  businessType: string;
  method: string;
  matchedObservation: string;
  confidence: number;
}

export interface AdaptiveBaseline {
  priorVersion: string;
  classification: CompanyClassification;
  assumptions: DcfAssumptions;
  traces: AssumptionTrace[];
}

export interface ProjectedCashFlow {
  year: number;
  stage: number;
  growthRate: number;
  freeCashFlow: number;
  discountFactor: number;
  presentValue: number;
}

export interface TerminalValueCalculation {
  finalProjectedFreeCashFlow: number;
  terminalYearFreeCashFlow: number;
  capitalizationSpread: number;
  undiscountedTerminalValue: number;
  discountFactor: number;
  presentValue: number;
  /** Share of enterprise value, as a decimal fraction. */
  concentration: number;
}

export interface ValuationDecomposition {
  presentValueStageOne: number;
  presentValueStageTwo: number;
  presentValueProjectedCashFlows: number;
  presentValueTerminalValue: number;
  enterpriseValue: number;
  netDebt: number;
  netDebtAdjustment: number;
  equityValue: number;
}

export interface SensitivityPoint {
  label: string;
  assumptions: DcfAssumptions;
  intrinsicValuePerShare: number;
}

export interface SensitivityInterval {
  method: string;
  /** Always false. The interval expresses assumption sensitivity, not likelihood. */
  isProbabilityInterval: boolean;
  growthRateDelta: number;
  discountRateDelta: number;
  centralValuePerShare: number;
  lowerBoundPerShare: number;
  upperBoundPerShare: number;
  evaluatedPoints: SensitivityPoint[];
}

export interface FcfStabilityAnalysis {
  observationCount: number;
  minimumFreeCashFlow: number;
  maximumFreeCashFlow: number;
  meanAbsoluteFreeCashFlow: number;
  normalizedRange: number;
  signChangeCount: number;
  isUnstable: boolean;
}

export interface DcfValuation {
  currency: string;
  startingFreeCashFlow: number;
  netDebt: number;
  dilutedShares: number;
  assumptions: DcfAssumptions;
  projectedCashFlows: ProjectedCashFlow[];
  terminalValue: TerminalValueCalculation;
  decomposition: ValuationDecomposition;
  intrinsicValuePerShare: number;
  sensitivityInterval: SensitivityInterval;
  fcfStability: FcfStabilityAnalysis | null;
  warnings: string[];
}

export interface AppliedAdjustment {
  assumption: string;
  label: string;
  baselineAssumption: number;
  aiAdjustment: number;
  finalAssumption: number;
  minimumAdjustment: number;
  maximumAdjustment: number;
  rationale: string;
  evidenceIds: string[];
  isolatedIntrinsicValuePerShare: number;
  isolatedValuationImpactPerShare: number;
}

export interface EvidenceAssessment {
  statement: string;
  claimType: ClaimType;
  support: EvidenceSupport;
  evidenceIds: string[];
}

export interface ValuationImpact {
  baselineIntrinsicValuePerShare: number;
  finalIntrinsicValuePerShare: number;
  absoluteChangePerShare: number;
  relativeChange: number | null;
}

export interface ConfidenceFactor {
  name: string;
  label: string;
  score: number;
  explanation: string;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  score: number;
  /** Always false. Confidence is not the probability of reaching the value. */
  isProbability: boolean;
  factors: ConfidenceFactor[];
  explanation: string;
}

export interface SupportingMetric {
  name: string;
  value: number;
  unit: string;
  fiscalPeriods: string[];
  calculation: string;
  evidenceIds: string[];
}

export interface ChecklistResult {
  checklistNumber: number;
  /** Verbatim DeltaDCF wording. Never edited, never reordered. */
  checklistText: string;
  status: ChecklistStatus;
  plainEnglishExplanation: string;
  technicalExplanation: string;
  applicabilityReason: string;
  metricsUsed: SupportingMetric[];
  evidenceIds: string[];
  missingInformation: string[];
  sectorContext: string;
  potentialValuationRelevance: string;
}

export interface ChecklistQualitativeFinding {
  checklistNumber: number;
  checklistText: string;
  status: ChecklistStatus;
  explanation: string;
  evidenceIds: string[];
  claimType: ClaimType;
}

export interface ChecklistDisagreement {
  checklistNumber: number;
  checklistText: string;
  deterministicStatus: ChecklistStatus;
  aiStatus: ChecklistStatus;
  evidenceIds: string[];
}

export interface DisagreementSummary {
  summary: string;
  checklistDisagreements: ChecklistDisagreement[];
  evidenceIds: string[];
}

export interface AiAnalysisResult {
  status: AiAnalysisStatus;
  fallbackReason: string | null;
  deterministicBaseline: AdaptiveBaseline;
  baselineValuation: DcfValuation;
  deterministicChecklist: ChecklistResult[];
  adjustments: AppliedAdjustment[];
  finalAssumptions: DcfAssumptions;
  finalValuation: DcfValuation;
  valuationImpact: ValuationImpact;
  evidenceAssessment: EvidenceAssessment[];
  confidence: ConfidenceAssessment;
  checklistQualitativeFindings: ChecklistQualitativeFinding[];
  disagreement: DisagreementSummary;
}

export interface MarketPrice {
  value: number;
  currency: string;
  asOf: string;
  source: string;
}

export interface FilingRecord {
  form: string;
  accessionNumber: string;
  filingDate: string;
  periodOfReport: string;
  /** Direct SEC document URL. */
  documentUrl: string;
  /** SEC filing index page for the same accession. */
  filingIndexUrl: string;
}

export interface NarrativeClaim {
  statement: string;
  evidenceIds: string[];
}

/** Reader-facing narrative that stays in plain language. */
export interface PlainNarrative {
  whatMustBeTrue: NarrativeClaim[];
  whatSupports: NarrativeClaim[];
  whatWeakens: NarrativeClaim[];
  whatCouldProveItWrong: NarrativeClaim[];
}

export interface AnalysisEnvelope {
  ticker: string;
  cik: string;
  companyName: string;
  /** Null whenever no market quote was retrieved. Never guessed. */
  marketPrice: MarketPrice | null;
  latestFiling: FilingRecord;
  /** Issuer annual-report landing page, when the issuer publishes one. */
  annualReportUrl: string | null;
  secRetrievedAt: string;
  dataFreshness: {
    secRetrievedAt: string;
    marketPriceAsOf: string | null;
    latestFiscalPeriodEnd: string;
    cachePolicy: string;
  };
  missingMetrics: string[];
  normalizationWarnings: NormalizationWarning[];
  facts: NormalizedFact[];
  evidence: EvidenceReference[];
  narrative: PlainNarrative;
  analysis: AiAnalysisResult;
  methodologyVersion: string;
  analysisVersion: string;
}
