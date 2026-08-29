import type {
  AiAnalysisStatus,
  ChecklistStatus,
  ClaimType,
  ConfidenceLevel,
  EvidenceSupport,
} from "@/lib/analysis-types";

export interface LiveEvidenceReference {
  evidenceId: string;
  sourceUrl: string;
  filingForm?: string;
  fiscalPeriod?: string;
  xbrlConcept?: string;
  description?: string;
}

export interface LiveChecklistResult {
  checklistNumber: number;
  checklistText: string;
  status: ChecklistStatus;
  plainEnglishExplanation: string;
  technicalExplanation: string;
  applicabilityReason: string;
  missingInformation: string[];
  sectorContext: string;
  potentialValuationRelevance: string;
  evidenceReferences: LiveEvidenceReference[];
}

export interface LiveDcfValuation {
  inputs: {
    startingFreeCashFlow: number;
    netDebt: number;
    dilutedShares: number;
    currency: string;
  };
  assumptions: {
    stageOneYears: number;
    stageTwoYears: number;
    stageOneGrowthRate: number;
    stageTwoGrowthRate: number;
    terminalGrowthRate: number;
    discountRate: number;
  };
  terminalValue: {
    concentration: number;
    presentValue: number;
  };
  decomposition: {
    presentValueProjectedCashFlows: number;
    presentValueTerminalValue: number;
    enterpriseValue: number;
    netDebt: number;
    equityValue: number;
  };
  intrinsicValuePerShare: number;
  sensitivityInterval: {
    isProbabilityInterval: boolean;
    lowerBoundPerShare: number;
    centralValuePerShare: number;
    upperBoundPerShare: number;
  };
  warnings: string[];
}

export interface LiveAnalysisEnvelope {
  ticker: string;
  cik: string;
  companyName: string;
  secRetrievedAt: string;
  latestFiling: {
    accessionNumber: string;
    filingForm: string;
    filingDate: string;
    reportDate: string;
    filingUrl: string;
  } | null;
  missingMetrics: string[];
  normalizationWarnings: Array<{ code: string; message: string }>;
  analysis: {
    status: AiAnalysisStatus;
    fallbackReason: string | null;
    deterministicBaseline: {
      priorVersion: string;
      classification: {
        sectorDisplayName: string;
        businessType: string;
      };
    };
    finalValuation: LiveDcfValuation;
    deterministicChecklist: LiveChecklistResult[];
    adjustments: Array<{
      assumption: string;
      baselineAssumption: number;
      aiAdjustment: number;
      finalAssumption: number;
      rationale: string;
      evidenceReferences: LiveEvidenceReference[];
    }>;
    evidenceAssessment: Array<{
      statement: string;
      claimType: ClaimType;
      support: EvidenceSupport;
      evidenceReferences: LiveEvidenceReference[];
    }>;
    confidence: {
      level: ConfidenceLevel;
      score: number;
      isProbability: boolean;
      explanation: string;
    };
    disagreement: {
      summary: string;
    };
  };
}
