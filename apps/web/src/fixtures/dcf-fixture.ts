import type {
  DcfAssumptions,
  DcfValuation,
  ProjectedCashFlow,
  SensitivityInterval,
  TerminalValueCalculation,
  ValuationDecomposition,
} from "@/lib/analysis-types";

/**
 * Fixture arithmetic only.
 *
 * This is not the product's valuation engine — that lives in
 * `apps/api/app/valuation/engine.py`. This mirrors the two-stage projection and
 * Gordon Growth terminal value described in `docs/dcf-engine.md` so that every
 * number shown in a fixture reconciles: the projected cash flows sum to the
 * present values, the present values sum to the enterprise value, and the
 * per-share figure follows from the equity value. Fixtures with numbers that do
 * not add up would make the "Know why" layer untestable.
 */

export interface DcfFixtureInput {
  startingFreeCashFlow: number;
  netDebt: number;
  dilutedShares: number;
  currency: string;
  assumptions: DcfAssumptions;
  growthRateDelta: number;
  discountRateDelta: number;
  historicalFreeCashFlows?: number[];
  warnings?: string[];
}

function project(
  startingFreeCashFlow: number,
  assumptions: DcfAssumptions,
): ProjectedCashFlow[] {
  const flows: ProjectedCashFlow[] = [];
  let freeCashFlow = startingFreeCashFlow;
  const total = assumptions.stageOneYears + assumptions.stageTwoYears;

  for (let year = 1; year <= total; year += 1) {
    const stage = year <= assumptions.stageOneYears ? 1 : 2;
    const growthRate =
      stage === 1 ? assumptions.stageOneGrowthRate : assumptions.stageTwoGrowthRate;
    freeCashFlow = freeCashFlow * (1 + growthRate);
    const discountFactor = 1 / (1 + assumptions.discountRate) ** year;
    flows.push({
      year,
      stage,
      growthRate,
      freeCashFlow,
      discountFactor,
      presentValue: freeCashFlow * discountFactor,
    });
  }
  return flows;
}

function intrinsicValuePerShare(input: DcfFixtureInput, assumptions: DcfAssumptions): number {
  const flows = project(input.startingFreeCashFlow, assumptions);
  const finalFlow = flows[flows.length - 1];
  const spread = assumptions.discountRate - assumptions.terminalGrowthRate;
  const terminalYearFlow = finalFlow.freeCashFlow * (1 + assumptions.terminalGrowthRate);
  const presentValueTerminal = (terminalYearFlow / spread) * finalFlow.discountFactor;
  const enterpriseValue =
    flows.reduce((total, flow) => total + flow.presentValue, 0) + presentValueTerminal;
  return (enterpriseValue - input.netDebt) / input.dilutedShares;
}

export function buildDcfValuation(input: DcfFixtureInput): DcfValuation {
  const { assumptions } = input;
  const flows = project(input.startingFreeCashFlow, assumptions);
  const finalFlow = flows[flows.length - 1];

  const capitalizationSpread = assumptions.discountRate - assumptions.terminalGrowthRate;
  const terminalYearFreeCashFlow = finalFlow.freeCashFlow * (1 + assumptions.terminalGrowthRate);
  const undiscountedTerminalValue = terminalYearFreeCashFlow / capitalizationSpread;
  const presentValueTerminalValue = undiscountedTerminalValue * finalFlow.discountFactor;

  const presentValueStageOne = flows
    .filter((flow) => flow.stage === 1)
    .reduce((total, flow) => total + flow.presentValue, 0);
  const presentValueStageTwo = flows
    .filter((flow) => flow.stage === 2)
    .reduce((total, flow) => total + flow.presentValue, 0);
  const presentValueProjectedCashFlows = presentValueStageOne + presentValueStageTwo;
  const enterpriseValue = presentValueProjectedCashFlows + presentValueTerminalValue;
  const equityValue = enterpriseValue - input.netDebt;

  const terminalValue: TerminalValueCalculation = {
    finalProjectedFreeCashFlow: finalFlow.freeCashFlow,
    terminalYearFreeCashFlow,
    capitalizationSpread,
    undiscountedTerminalValue,
    discountFactor: finalFlow.discountFactor,
    presentValue: presentValueTerminalValue,
    concentration: presentValueTerminalValue / enterpriseValue,
  };

  const decomposition: ValuationDecomposition = {
    presentValueStageOne,
    presentValueStageTwo,
    presentValueProjectedCashFlows,
    presentValueTerminalValue,
    enterpriseValue,
    netDebt: input.netDebt,
    netDebtAdjustment: -input.netDebt,
    equityValue,
  };

  const lowerAssumptions: DcfAssumptions = {
    ...assumptions,
    stageOneGrowthRate: assumptions.stageOneGrowthRate - input.growthRateDelta,
    stageTwoGrowthRate: assumptions.stageTwoGrowthRate - input.growthRateDelta,
    discountRate: assumptions.discountRate + input.discountRateDelta,
  };
  const upperAssumptions: DcfAssumptions = {
    ...assumptions,
    stageOneGrowthRate: assumptions.stageOneGrowthRate + input.growthRateDelta,
    stageTwoGrowthRate: assumptions.stageTwoGrowthRate + input.growthRateDelta,
    discountRate: assumptions.discountRate - input.discountRateDelta,
  };

  const centralValuePerShare = equityValue / input.dilutedShares;
  const lowerBoundPerShare = intrinsicValuePerShare(input, lowerAssumptions);
  const upperBoundPerShare = intrinsicValuePerShare(input, upperAssumptions);

  const sensitivityInterval: SensitivityInterval = {
    method: "two_point_assumption_perturbation",
    isProbabilityInterval: false,
    growthRateDelta: input.growthRateDelta,
    discountRateDelta: input.discountRateDelta,
    centralValuePerShare,
    lowerBoundPerShare,
    upperBoundPerShare,
    evaluatedPoints: [
      {
        label: "Lower: slower growth, higher discount rate",
        assumptions: lowerAssumptions,
        intrinsicValuePerShare: lowerBoundPerShare,
      },
      {
        label: "Upper: faster growth, lower discount rate",
        assumptions: upperAssumptions,
        intrinsicValuePerShare: upperBoundPerShare,
      },
    ],
  };

  const history = input.historicalFreeCashFlows ?? [];
  const warnings = [...(input.warnings ?? [])];
  if (input.startingFreeCashFlow < 0) {
    warnings.unshift("negative_starting_free_cash_flow");
  }
  if (terminalValue.concentration >= 0.75) {
    warnings.push("high_terminal_value_concentration");
  }
  if (equityValue <= 0) {
    warnings.push("non_positive_equity_value");
  }

  return {
    currency: input.currency,
    startingFreeCashFlow: input.startingFreeCashFlow,
    netDebt: input.netDebt,
    dilutedShares: input.dilutedShares,
    assumptions,
    projectedCashFlows: flows,
    terminalValue,
    decomposition,
    intrinsicValuePerShare: centralValuePerShare,
    sensitivityInterval,
    fcfStability: history.length >= 2 ? stability(history) : null,
    warnings: [...new Set(warnings)],
  };
}

function stability(history: number[]) {
  const minimum = Math.min(...history);
  const maximum = Math.max(...history);
  const meanAbsolute =
    history.reduce((total, value) => total + Math.abs(value), 0) / history.length;
  const normalizedRange = meanAbsolute === 0 ? 0 : (maximum - minimum) / meanAbsolute;
  let signChangeCount = 0;
  for (let index = 1; index < history.length; index += 1) {
    if (Math.sign(history[index]) !== Math.sign(history[index - 1])) {
      signChangeCount += 1;
    }
  }
  return {
    observationCount: history.length,
    minimumFreeCashFlow: minimum,
    maximumFreeCashFlow: maximum,
    meanAbsoluteFreeCashFlow: meanAbsolute,
    normalizedRange,
    signChangeCount,
    isUnstable: normalizedRange >= 1 || signChangeCount > 0,
  };
}
