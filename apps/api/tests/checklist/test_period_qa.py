from dataclasses import replace

from app.checklist import evaluate_checklist
from app.checklist.models import ChecklistInput, QualitativeChecklistFacts, ChecklistStatus
from app.data.sec import normalize_company_facts
from tests.fixtures.sec.company_facts import technology_company


def test_checklist_does_not_compare_different_duration_windows():
    normalized = normalize_company_facts(technology_company())
    facts = dict(normalized.facts)
    facts["gross_profit"] = (replace(facts["gross_profit"][0], period_start="2023-11-01"),)
    result = evaluate_checklist(ChecklistInput(
        replace(normalized, facts=facts), "technology", "hardware", QualitativeChecklistFacts(),
    ))
    assert result.results[0].status is ChecklistStatus.UNKNOWN
