export type ChecklistStatus = "SUPPORTS" | "WEAKENS" | "MONITOR" | "UNKNOWN" | "NOT_APPLICABLE";

export const fixtureAnalysis = {
  ticker: "AAPL",
  company: "Technology company fixture",
  fiscalPeriod: "FY 2024",
  filingDate: "2025-01-31",
  accessionNumber: "0000320193-25-000003",
  valuation: {
    intrinsicValuePerShare: 96.86,
    sensitivityLow: 78.69,
    sensitivityHigh: 124.14,
    terminalValueConcentration: 43.35,
  },
  assumptions: [
    { label: "Stage-one growth", value: "9.67%", period: "Years 1–5", explanation: "A bounded blend of normalized cash-flow growth, revenue growth, stability, maturity, and the technology sector prior." },
    { label: "Stage-two growth", value: "5.67%", period: "Years 6–10", explanation: "Growth fades toward the terminal rate instead of staying elevated indefinitely." },
    { label: "Discount rate", value: "13.15%", period: "All years", explanation: "The transparent sector baseline is adjusted by deterministic company-risk modifiers." },
    { label: "Terminal growth", value: "3.00%", period: "Year 11 onward", explanation: "A long-run nominal growth assumption below the discount rate, held within a conservative bound." },
  ],
  facts: [
    { label: "Revenue", value: "$400.0bn", concept: "Revenues" },
    { label: "Gross profit", value: "$180.0bn", concept: "GrossProfit" },
    { label: "Net income", value: "$95.0bn", concept: "NetIncomeLoss" },
    { label: "Operating cash flow", value: "$120.0bn", concept: "NetCashProvidedByUsedInOperatingActivities" },
    { label: "Capital expenditure", value: "$14.0bn", concept: "PaymentsToAcquirePropertyPlantAndEquipment" },
    { label: "Normalized free cash flow", value: "$106.0bn", concept: "Calculated" },
  ],
  evidence: {
    id: "sec:320193:0000320193-25-000003:Revenues:FY2024",
    filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000003/aapl-20241231x10ka.htm",
  },
  checklist: [
    { number: 1, text: "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat", status: "SUPPORTS" as ChecklistStatus, note: "The fixture gross margin is 45.0%; sector context still matters." },
    { number: 2, text: "Revenue Growth: In line with the gross profit growth", status: "MONITOR" as ChecklistStatus, note: "A comparative annual series is required before drawing a conclusion." },
    { number: 3, text: "EPS: Consistent with Net Profits (check for dilution)", status: "SUPPORTS" as ChecklistStatus, note: "Diluted EPS and diluted average shares are present in the filing facts." },
    { number: 4, text: "Debt Level: Company should not be highly leveraged", status: "MONITOR" as ChecklistStatus, note: "Debt must be read alongside cash generation and liquidity." },
    { number: 5, text: "Inventory: Check for growing inventory along with PAT margin (manufacturing)", status: "MONITOR" as ChecklistStatus, note: "Inventory is available, but a comparative trend is required." },
    { number: 6, text: "Sales vs Receivables: Revenue should be backed by cash collections, not just receivables", status: "MONITOR" as ChecklistStatus, note: "Receivables are available; trend evidence is incomplete." },
    { number: 7, text: "Cash flow from operations: Must be positive", status: "SUPPORTS" as ChecklistStatus, note: "The fixture reports positive operating cash flow of $120.0bn." },
    { number: 8, text: "Return on Equity > 25%", status: "SUPPORTS" as ChecklistStatus, note: "The threshold is met, with a caveat that buybacks can distort equity." },
    { number: 9, text: "Business Diversity: Prefer 1 or 2 simple business lines", status: "UNKNOWN" as ChecklistStatus, note: "Structured filing facts do not establish business-line simplicity." },
    { number: 10, text: "Subsidiaries: Not too many (check for siphoning risk)", status: "UNKNOWN" as ChecklistStatus, note: "Subsidiary count alone is not evidence of misconduct." },
  ],
} as const;

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
