from __future__ import annotations

from app.checklist.models import ChecklistItem


ORIGINAL_CHECKLIST: tuple[ChecklistItem, ...] = (
    ChecklistItem(
        1,
        "Gross Profit Margin > 20%: Higher the margin, higher is the evidence of a sustainable moat",
    ),
    ChecklistItem(2, "Revenue Growth: In line with the gross profit growth"),
    ChecklistItem(3, "EPS: Consistent with Net Profits (check for dilution)"),
    ChecklistItem(4, "Debt Level: Company should not be highly leveraged"),
    ChecklistItem(
        5,
        "Inventory: Check for growing inventory along with PAT margin (manufacturing)",
    ),
    ChecklistItem(
        6,
        "Sales vs Receivables: Revenue should be backed by cash collections, not just receivables",
    ),
    ChecklistItem(7, "Cash flow from operations: Must be positive"),
    ChecklistItem(8, "Return on Equity > 25%"),
    ChecklistItem(9, "Business Diversity: Prefer 1 or 2 simple business lines"),
    ChecklistItem(10, "Subsidiaries: Not too many (check for siphoning risk)"),
)


def assert_original_contract() -> None:
    """Fail closed if runtime code constructs a changed checklist contract."""
    if len(ORIGINAL_CHECKLIST) != 10:
        raise RuntimeError("The DeltaDCF checklist must contain exactly ten items")
    if tuple(item.number for item in ORIGINAL_CHECKLIST) != tuple(range(1, 11)):
        raise RuntimeError("The DeltaDCF checklist order must remain 1 through 10")
