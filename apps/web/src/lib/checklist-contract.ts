/**
 * Verbatim mirror of `ORIGINAL_CHECKLIST` in
 * `apps/api/app/checklist/contract.py`.
 *
 * The wording and the order are the contract. Nothing in the client may edit,
 * reword, reorder, or drop an item. Sector context changes only applicability,
 * evidence, and interpretation.
 */

export interface ChecklistItem {
  number: number;
  text: string;
}

export const ORIGINAL_CHECKLIST: readonly ChecklistItem[] = [
  {
    number: 1,
    text: "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat",
  },
  { number: 2, text: "Revenue Growth: In line with the gross profit growth" },
  { number: 3, text: "EPS: Consistent with Net Profits (check for dilution)" },
  { number: 4, text: "Debt Level: Company should not be highly leveraged" },
  {
    number: 5,
    text: "Inventory: Check for growing inventory along with PAT margin (manufacturing)",
  },
  {
    number: 6,
    text: "Sales vs Receivables: Revenue should be backed by cash collections, not just receivables",
  },
  { number: 7, text: "Cash flow from operations: Must be positive" },
  { number: 8, text: "Return on Equity > 25%" },
  { number: 9, text: "Business Diversity: Prefer 1 or 2 simple business lines" },
  { number: 10, text: "Subsidiaries: Not too many (check for siphoning risk)" },
] as const;

/** Fails closed if a caller ever constructs a changed checklist contract. */
export function assertOriginalContract(items: readonly ChecklistItem[]): void {
  if (items.length !== ORIGINAL_CHECKLIST.length) {
    throw new Error("The DeltaDCF checklist must contain exactly ten items");
  }
  for (const [index, item] of items.entries()) {
    const expected = ORIGINAL_CHECKLIST[index];
    if (item.number !== expected.number || item.text !== expected.text) {
      throw new Error(
        `The DeltaDCF checklist wording and order are fixed; item ${index + 1} was changed`,
      );
    }
  }
}

export function checklistText(number: number): string {
  const item = ORIGINAL_CHECKLIST.find((entry) => entry.number === number);
  if (item === undefined) {
    throw new Error(`No checklist item numbered ${number}`);
  }
  return item.text;
}
