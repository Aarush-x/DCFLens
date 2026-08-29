import type {
  AnalysisEnvelope,
  ChecklistDisagreement,
  ChecklistStatus,
  EvidenceReference,
} from "@/lib/analysis-types";
import { formatUsd } from "@/lib/format";

/**
 * Derives the plain-English layer from an analysis envelope.
 *
 * Two rules drive everything here:
 *
 * 1. A supporting (green) reading is never earned by a positive intrinsic
 *    value. It requires evidence strength, an available model result, no
 *    checklist disagreement, and no fragility signal.
 * 2. Disagreements are reported as separate statements. They are never
 *    averaged into a single score or hidden behind a verdict.
 */

export type VerdictTone = "supports" | "monitor" | "weakens" | "unknown";

export type PricePosition =
  | "below_interval"
  | "inside_interval"
  | "above_interval"
  | "unavailable";

export interface PriceComparison {
  isAvailable: boolean;
  position: PricePosition;
  price: number | null;
  currency: string;
  asOf: string | null;
  source: string | null;
  differencePerShare: number | null;
  relativeDifference: number | null;
  statement: string;
}

export type EvidenceStrengthLabel = "Strong" | "Mixed" | "Thin" | "None";

export interface EvidenceStrength {
  label: EvidenceStrengthLabel;
  supported: number;
  partiallySupported: number;
  unsupported: number;
  contradicted: number;
  total: number;
  citedEvidenceCount: number;
  statement: string;
}

export type AiCoverageLevel = "full" | "partial" | "unavailable";

export interface AiCoverage {
  level: AiCoverageLevel;
  statement: string;
  reason: string | null;
}

export interface DisagreementStatement {
  kind:
    | "checklist"
    | "model_summary"
    | "price_versus_evidence"
    | "model_versus_baseline"
    | "model_unavailable";
  text: string;
}

export interface DisagreementState {
  hasDisagreement: boolean;
  headline: string;
  statements: DisagreementStatement[];
  checklistDisagreements: ChecklistDisagreement[];
}

export interface Fragility {
  isFragile: boolean;
  reasons: string[];
}

export interface ChecklistSummary {
  counts: Record<ChecklistStatus, number>;
  total: number;
  statement: string;
}

export interface AnalysisView {
  isValuationMeaningful: boolean;
  tone: VerdictTone;
  verdict: string;
  verdictDetail: string;
  intervalStatement: string;
  price: PriceComparison;
  evidence: EvidenceStrength;
  aiCoverage: AiCoverage;
  fragility: Fragility;
  disagreement: DisagreementState;
  checklistSummary: ChecklistSummary;
  evidenceById: Map<string, EvidenceReference>;
}

const FRAGILE_TERMINAL_CONCENTRATION = 0.75;
const FRAGILE_INTERVAL_WIDTH_RATIO = 0.5;

export function buildAnalysisView(envelope: AnalysisEnvelope): AnalysisView {
  const { analysis } = envelope;
  const valuation = analysis.finalValuation;

  const isValuationMeaningful =
    Number.isFinite(valuation.intrinsicValuePerShare) &&
    valuation.intrinsicValuePerShare > 0 &&
    !valuation.warnings.includes("non_positive_equity_value");

  const evidence = buildEvidenceStrength(envelope);
  const aiCoverage = buildAiCoverage(envelope);
  const fragility = buildFragility(envelope, evidence, aiCoverage);
  const price = buildPriceComparison(envelope);
  const checklistSummary = buildChecklistSummary(envelope);
  const disagreement = buildDisagreement(envelope, price, fragility, aiCoverage);

  const tone = resolveTone({
    isValuationMeaningful,
    evidence,
    aiCoverage,
    fragility,
    hasDisagreement: disagreement.hasDisagreement,
    confidenceLevel: analysis.confidence.level,
  });

  return {
    isValuationMeaningful,
    tone,
    verdict: buildVerdict(envelope, isValuationMeaningful, price, fragility),
    verdictDetail: buildVerdictDetail(envelope, isValuationMeaningful, price),
    intervalStatement: buildIntervalStatement(envelope),
    price,
    evidence,
    aiCoverage,
    fragility,
    disagreement,
    checklistSummary,
    evidenceById: new Map(envelope.evidence.map((item) => [item.evidenceId, item])),
  };
}

function buildPriceComparison(envelope: AnalysisEnvelope): PriceComparison {
  const valuation = envelope.analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const quote = envelope.marketPrice;

  if (quote === null) {
    return {
      isAvailable: false,
      position: "unavailable",
      price: null,
      currency: valuation.currency,
      asOf: null,
      source: null,
      differencePerShare: null,
      relativeDifference: null,
      statement:
        "We do not have a market price for this company right now, so there is nothing to compare the estimate against. Treat the figure as an estimate on its own, not as a signal to act.",
    };
  }

  const position: PricePosition =
    quote.value < interval.lowerBoundPerShare
      ? "below_interval"
      : quote.value > interval.upperBoundPerShare
        ? "above_interval"
        : "inside_interval";

  const difference = valuation.intrinsicValuePerShare - quote.value;
  const relativeDifference = quote.value === 0 ? null : difference / quote.value;

  const statement =
    position === "below_interval"
      ? `Today's price of ${formatUsd(quote.value, quote.currency)} is below the low end of that range.`
      : position === "above_interval"
        ? `Today's price of ${formatUsd(quote.value, quote.currency)} is above the high end of that range.`
        : `Today's price of ${formatUsd(quote.value, quote.currency)} sits inside that range.`;

  return {
    isAvailable: true,
    position,
    price: quote.value,
    currency: quote.currency,
    asOf: quote.asOf,
    source: quote.source,
    differencePerShare: difference,
    relativeDifference,
    statement,
  };
}

function buildEvidenceStrength(envelope: AnalysisEnvelope): EvidenceStrength {
  const items = envelope.analysis.evidenceAssessment;
  const supported = items.filter((item) => item.support === "SUPPORTED").length;
  const partiallySupported = items.filter((item) => item.support === "PARTIALLY_SUPPORTED").length;
  const unsupported = items.filter((item) => item.support === "UNSUPPORTED").length;
  const contradicted = items.filter((item) => item.support === "CONTRADICTED").length;
  const total = items.length;
  const citedEvidenceCount = new Set(items.flatMap((item) => item.evidenceIds)).size;

  let label: EvidenceStrengthLabel;
  let statement: string;

  if (total === 0) {
    label = "None";
    statement =
      "No written claims were checked against the filings for this company. Everything shown comes from the reported numbers alone.";
  } else if (contradicted > 0) {
    label = "Thin";
    statement = `${contradicted} of ${total} written claims ${contradicted === 1 ? "is" : "are"} contradicted by the filings we read. Read ${contradicted === 1 ? "it" : "them"} sceptically.`;
  } else if (unsupported + partiallySupported > supported) {
    label = "Thin";
    statement = `Only ${supported} of ${total} written claims are fully backed by a filing we can link to. The rest are partly backed or unbacked.`;
  } else if (supported === total) {
    label = "Strong";
    statement = `All ${total} written claims point at a specific filing you can open and check.`;
  } else {
    label = "Mixed";
    statement = `${supported} of ${total} written claims are fully backed by a filing you can open; the others are only partly backed.`;
  }

  return {
    label,
    supported,
    partiallySupported,
    unsupported,
    contradicted,
    total,
    citedEvidenceCount,
    statement,
  };
}

function buildAiCoverage(envelope: AnalysisEnvelope): AiCoverage {
  const { analysis } = envelope;

  if (analysis.status === "DETERMINISTIC_FALLBACK") {
    return {
      level: "unavailable",
      reason: analysis.fallbackReason,
      statement:
        "The written review did not run. Everything on this page comes from the reported filing numbers and the fixed calculation, with no wording changes and no adjusted assumptions.",
    };
  }

  const missingFindings =
    analysis.checklistQualitativeFindings.length < analysis.deterministicChecklist.length;
  const noAssessment = analysis.evidenceAssessment.length === 0;

  if (missingFindings || noAssessment) {
    return {
      level: "partial",
      reason: noAssessment
        ? "The written review returned no evidence-checked claims."
        : `The written review covered ${analysis.checklistQualitativeFindings.length} of the ${analysis.deterministicChecklist.length} checklist points.`,
      statement:
        "The written review only came back in part. The parts that are missing fall back to the reported numbers, and nothing has been filled in for them.",
    };
  }

  return {
    level: "full",
    reason: null,
    statement:
      "The written review ran in full, and every change it asked for is listed separately from the underlying calculation.",
  };
}

function buildFragility(
  envelope: AnalysisEnvelope,
  evidence: EvidenceStrength,
  aiCoverage: AiCoverage,
): Fragility {
  const { analysis } = envelope;
  const valuation = analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const reasons: string[] = [];

  if (valuation.terminalValue.concentration >= FRAGILE_TERMINAL_CONCENTRATION) {
    reasons.push(
      `Most of the value — ${(valuation.terminalValue.concentration * 100).toFixed(1)}% — rests on what happens after year ${valuation.assumptions.stageOneYears + valuation.assumptions.stageTwoYears}, which is the hardest part to know.`,
    );
  }

  const central = Math.abs(interval.centralValuePerShare);
  const width = interval.upperBoundPerShare - interval.lowerBoundPerShare;
  if (central > 0 && width / central >= FRAGILE_INTERVAL_WIDTH_RATIO) {
    reasons.push(
      "Small changes to the growth and discount assumptions move the estimate a long way, so the estimate is not stable.",
    );
  }

  if (valuation.fcfStability?.isUnstable) {
    reasons.push(
      "The company's past spare cash has jumped around, so the starting point for the estimate is itself uncertain.",
    );
  }

  if (analysis.confidence.level === "Low") {
    reasons.push("The overall confidence in the inputs is low.");
  }

  if (evidence.label === "Thin" || evidence.label === "None") {
    reasons.push("The written claims are not well backed by the filings.");
  }

  if (aiCoverage.level !== "full") {
    reasons.push("Part of the written review is missing, so the picture is incomplete.");
  }

  if (envelope.missingMetrics.length > 0) {
    reasons.push(
      `${envelope.missingMetrics.length} figure${envelope.missingMetrics.length === 1 ? "" : "s"} we normally use could not be found in the filings.`,
    );
  }

  return { isFragile: reasons.length > 0, reasons };
}

function buildChecklistSummary(envelope: AnalysisEnvelope): ChecklistSummary {
  const results = envelope.analysis.deterministicChecklist;
  const counts: Record<ChecklistStatus, number> = {
    SUPPORTS: 0,
    WEAKENS: 0,
    MONITOR: 0,
    UNKNOWN: 0,
    NOT_APPLICABLE: 0,
  };
  for (const result of results) {
    counts[result.status] += 1;
  }

  const parts: string[] = [];
  if (counts.SUPPORTS > 0)
    parts.push(
      counts.SUPPORTS === 1 ? "1 point favours the company" : `${counts.SUPPORTS} points favour the company`,
    );
  if (counts.WEAKENS > 0) parts.push(`${counts.WEAKENS} against it`);
  if (counts.MONITOR > 0) parts.push(`${counts.MONITOR} worth watching`);
  if (counts.UNKNOWN > 0) parts.push(`${counts.UNKNOWN} we could not answer`);
  if (counts.NOT_APPLICABLE > 0) parts.push(`${counts.NOT_APPLICABLE} that does not apply to this kind of business`);

  const statement =
    parts.length === 0
      ? "The ten-point checklist returned no results."
      : `Of the ten checks, ${joinWithAnd(parts)}.`;

  return { counts, total: results.length, statement };
}

function buildDisagreement(
  envelope: AnalysisEnvelope,
  price: PriceComparison,
  fragility: Fragility,
  aiCoverage: AiCoverage,
): DisagreementState {
  const { analysis } = envelope;
  const statements: DisagreementStatement[] = [];

  if (price.position === "below_interval" && fragility.isFragile) {
    statements.push({
      kind: "price_versus_evidence",
      text: "Apparently cheap, but the evidence suggests the valuation is fragile.",
    });
  }

  // The analysis writes its own summary of how the two readings compare. It is
  // always shown: when the model was cut off or never ran, that summary is the
  // only place the reader is told so.
  if (analysis.disagreement.summary !== "") {
    statements.push({
      kind:
        analysis.disagreement.checklistDisagreements.length > 0 ? "checklist" : "model_summary",
      text: analysis.disagreement.summary,
    });
  }

  const movedAssumptions = analysis.adjustments.filter((item) => item.aiAdjustment !== 0);
  if (movedAssumptions.length > 0) {
    statements.push({
      kind: "model_versus_baseline",
      text: `The written review moved ${movedAssumptions.length} assumption${movedAssumptions.length === 1 ? "" : "s"} away from the standard starting point. Each change is listed on its own below, with the reason and the source behind it.`,
    });
  }

  if (aiCoverage.level === "unavailable") {
    statements.push({
      kind: "model_unavailable",
      text: "The written review is unavailable, so there is nothing to compare the reported numbers against.",
    });
  }

  const hasDisagreement = statements.some(
    (item) => item.kind === "checklist" || item.kind === "price_versus_evidence",
  );

  const headline =
    statements[0]?.text ??
    "Nothing here pulls in two directions. The reported numbers and the written review agree.";


  return {
    hasDisagreement,
    headline,
    statements,
    checklistDisagreements: analysis.disagreement.checklistDisagreements,
  };
}

function resolveTone(input: {
  isValuationMeaningful: boolean;
  evidence: EvidenceStrength;
  aiCoverage: AiCoverage;
  fragility: Fragility;
  hasDisagreement: boolean;
  confidenceLevel: "High" | "Medium" | "Low";
}): VerdictTone {
  if (!input.isValuationMeaningful) {
    return "weakens";
  }
  if (input.hasDisagreement || input.fragility.isFragile) {
    return "monitor";
  }
  if (input.aiCoverage.level !== "full") {
    return "monitor";
  }
  if (input.evidence.label !== "Strong") {
    return "monitor";
  }
  if (input.confidenceLevel === "Low") {
    return "monitor";
  }
  return "supports";
}

function buildVerdict(
  envelope: AnalysisEnvelope,
  isValuationMeaningful: boolean,
  price: PriceComparison,
  fragility: Fragility,
): string {
  const name = envelope.companyName;

  if (!isValuationMeaningful) {
    return endSentence(`We cannot put a reliable value on one share of ${name}`);
  }

  if (!price.isAvailable) {
    return fragility.isFragile
      ? `Here is what ${name}'s filings suggest a share is worth — but the estimate rests on shaky ground.`
      : `Here is what ${name}'s filings suggest a share is worth.`;
  }

  if (price.position === "below_interval") {
    return fragility.isFragile
      ? `${name} looks cheap on these numbers, but the reasoning behind them is fragile.`
      : `${name} trades below what its filings suggest a share is worth.`;
  }

  if (price.position === "above_interval") {
    return `${name} trades above what its filings suggest a share is worth.`;
  }

  return `${name} trades roughly in line with what its filings suggest a share is worth.`;
}

function buildVerdictDetail(
  envelope: AnalysisEnvelope,
  isValuationMeaningful: boolean,
  price: PriceComparison,
): string {
  if (!isValuationMeaningful) {
    const warnings = envelope.analysis.finalValuation.warnings;
    if (warnings.includes("non_positive_equity_value")) {
      return "After subtracting what the company owes, there is nothing left over for shareholders in this calculation. That is a result worth reading, not a price to act on.";
    }
    return "The filings do not contain enough of the right numbers to produce an estimate we would stand behind.";
  }
  if (!price.isAvailable) {
    return `${price.statement} An estimate on its own cannot tell you whether a share is cheap or expensive.`;
  }
  return price.statement;
}

function buildIntervalStatement(envelope: AnalysisEnvelope): string {
  const valuation = envelope.analysis.finalValuation;
  const interval = valuation.sensitivityInterval;
  const growth = (interval.growthRateDelta * 100).toFixed(2);
  const discount = (interval.discountRateDelta * 100).toFixed(2);
  return `Lower the growth assumption by ${growth} percentage points and raise the return investors require by ${discount}, and the estimate falls to ${formatUsd(interval.lowerBoundPerShare, valuation.currency)}. Move both the other way and it rises to ${formatUsd(interval.upperBoundPerShare, valuation.currency)}. That is a spread of assumptions, not a forecast of where the price will go.`;
}

/** Avoids a doubled full stop when a company name already ends in one. */
function endSentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
