import { describe, expect, it } from "vitest";

import { ORIGINAL_CHECKLIST, assertOriginalContract, checklistText } from "@/lib/checklist-contract";

describe("original checklist contract", () => {
  it("holds exactly the ten items, in order", () => {
    expect(ORIGINAL_CHECKLIST).toHaveLength(10);
    expect(ORIGINAL_CHECKLIST.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ORIGINAL_CHECKLIST[0].text).toBe(
      "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat",
    );
    expect(ORIGINAL_CHECKLIST[9].text).toBe(
      "Subsidiaries: Not too many (check for siphoning risk)",
    );
  });

  it("rejects reworded items", () => {
    const reworded = ORIGINAL_CHECKLIST.map((item) =>
      item.number === 7 ? { ...item, text: "Cash flow from operations must be positive" } : item,
    );
    expect(() => assertOriginalContract(reworded)).toThrow(/wording and order are fixed/);
  });

  it("rejects reordered items", () => {
    const reordered = [ORIGINAL_CHECKLIST[1], ORIGINAL_CHECKLIST[0], ...ORIGINAL_CHECKLIST.slice(2)];
    expect(() => assertOriginalContract(reordered)).toThrow(/wording and order are fixed/);
  });

  it("rejects a dropped item", () => {
    expect(() => assertOriginalContract(ORIGINAL_CHECKLIST.slice(0, 9))).toThrow(/exactly ten/);
  });

  it("looks an item up by number", () => {
    expect(checklistText(8)).toBe("Return on Equity > 25%");
    expect(() => checklistText(11)).toThrow(/No checklist item/);
  });
});
