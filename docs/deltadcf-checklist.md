# DeltaDCF 10-point checklist

## Preservation rule

The following checklist is copied unchanged from DeltaDCF `backend/api.py` at reference commit `d13b2ea24a4a8446373b3bde51f86aab136f8f27`. Wording, order, capitalization, thresholds, and parenthetical notes are preserved.

1. Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat
2. Revenue Growth: In line with the gross profit growth
3. EPS: Consistent with Net Profits (check for dilution)
4. Debt Level: Company should not be highly leveraged
5. Inventory: Check for growing inventory along with PAT margin (manufacturing)
6. Sales vs Receivables: Revenue should be backed by cash collections, not just receivables
7. Cash flow from operations: Must be positive
8. Return on Equity > 25%
9. Business Diversity: Prefer 1 or 2 simple business lines
10. Subsidiaries: Not too many (check for siphoning risk)

## DCFLens evaluation policy

The checklist text is unchanged, but evaluation becomes more explicit:

| Item | Preferred evidence | Initial evaluation mode |
| --- | --- | --- |
| 1 | Revenue and gross profit facts across periods | Deterministic ratio plus trend context |
| 2 | Revenue and gross profit facts across periods | Deterministic comparative trend |
| 3 | Net income, diluted EPS, and diluted shares | Deterministic trend plus dilution warning |
| 4 | Debt, assets, cash, and coverage facts where available | Deterministic metrics with disclosed thresholds |
| 5 | Inventory, net income, and revenue across periods | Deterministic trend; `UNKNOWN` when not applicable or missing |
| 6 | Revenue, receivables, and operating cash flow | Deterministic trend plus filing context |
| 7 | Operating cash flow across periods | Deterministic status |
| 8 | Net income and average equity | Deterministic ratio with period alignment |
| 9 | 10-K Item 1 and segment disclosures | Evidence-backed qualitative assessment |
| 10 | Exhibit 21 and related-party disclosures | Evidence-backed qualitative assessment |

`PASS`, `FAIL`, and `MONITOR` require evidence. `UNKNOWN` is required when the available evidence cannot support a conclusion. The preserved checklist must not be quietly rewritten to fit available data.
