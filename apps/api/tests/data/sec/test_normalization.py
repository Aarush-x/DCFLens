from __future__ import annotations

import json
from dataclasses import replace

import pytest

from app.data.sec.errors import SecDataError
from app.data.sec.normalization import OUTPUT_METRICS, normalize_company_facts
from tests.fixtures.sec.company_facts import (
    bank_company,
    conflicting_facts_company,
    missing_facts_company,
    retail_company,
    technology_company,
    utility_company,
)


def test_technology_company_normalizes_all_requested_metrics() -> None:
    result = normalize_company_facts(technology_company())

    assert result.missing_metrics == ()
    assert set(result.facts) == set(OUTPUT_METRICS)
    assert len(result.facts["revenue"]) == 2
    assert result.latest("revenue").value == pytest.approx(400_000.0)
    assert result.latest("free_cash_flow").value == pytest.approx(106_000.0)
    assert result.latest("free_cash_flow").quality == "calculated"
    assert len(result.latest("free_cash_flow").evidence) == 2

    evidence = result.latest("revenue").evidence[0]
    assert evidence.provider == "SEC EDGAR"
    assert evidence.cik == "0000320193"
    assert evidence.accession_number == "0000320193-25-000001"
    assert evidence.filing_form == "10-K"
    assert evidence.filing_date == "2025-02-15"
    assert evidence.fiscal_period == "FY"
    assert evidence.xbrl_concept == (
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
    )
    assert evidence.unit == "USD"
    assert evidence.raw_value == pytest.approx(400_000.0)
    assert evidence.normalized_value == pytest.approx(400_000.0)
    assert evidence.transformation == "reported_value"
    assert evidence.source_url == result.source_url
    assert evidence.retrieved_at == result.retrieved_at


def test_retail_company_normalizes_inventory_receivables_and_capex_sign() -> None:
    result = normalize_company_facts(retail_company())

    assert result.latest("revenue").evidence[0].xbrl_concept.endswith(
        "SalesRevenueNet"
    )
    assert result.latest("inventory").value == pytest.approx(58_000.0)
    assert result.latest("receivables").value == pytest.approx(9_000.0)
    assert result.latest("capital_expenditure").value == pytest.approx(22_000.0)
    assert result.latest("capital_expenditure").evidence[0].raw_value == pytest.approx(
        -22_000.0
    )
    assert result.latest("free_cash_flow").value == pytest.approx(14_000.0)


def test_bank_company_returns_safe_partial_data_for_inapplicable_metrics() -> None:
    result = normalize_company_facts(bank_company())

    assert result.latest("revenue").value == pytest.approx(90_000.0)
    assert result.latest("net_income").value == pytest.approx(12_000.0)
    assert result.latest("total_assets").value == pytest.approx(1_600_000.0)
    assert "gross_profit" in result.missing_metrics
    assert "inventory" in result.missing_metrics
    assert "operating_cash_flow" in result.missing_metrics
    assert any(
        warning.code == "missing_metric" and warning.metric == "gross_profit"
        for warning in result.warnings
    )


def test_utility_company_derives_debt_cash_and_free_cash_flow() -> None:
    result = normalize_company_facts(utility_company())

    debt = result.latest("total_debt")
    cash = result.latest("cash_and_short_term_investments")
    free_cash_flow = result.latest("free_cash_flow")
    assert debt.value == pytest.approx(26_000.0)
    assert debt.quality == "calculated"
    assert len(debt.evidence) == 2
    assert cash.value == pytest.approx(1_050.0)
    assert cash.quality == "calculated"
    assert free_cash_flow.value == pytest.approx(1_100.0)
    assert "current_debt + noncurrent_debt" in debt.evidence[0].transformation


def test_missing_facts_return_partial_result_instead_of_zeroes() -> None:
    result = normalize_company_facts(missing_facts_company())

    assert result.latest("total_assets").value == pytest.approx(1_000.0)
    assert result.latest("revenue") is None
    assert "revenue" in result.missing_metrics
    assert "free_cash_flow" in result.missing_metrics
    assert len(result.missing_metrics) == len(OUTPUT_METRICS) - 1
    json.dumps(result.to_dict(), default=str)


def test_conflicts_restatements_amendments_and_comparatives_are_preserved() -> None:
    result = normalize_company_facts(conflicting_facts_company())
    revenues = result.facts["revenue"]

    assert len(revenues) == 2
    assert revenues[0].fiscal_year == 2024
    assert revenues[0].value == pytest.approx(110.0)
    assert revenues[0].evidence[0].filing_form == "10-K/A"
    assert revenues[0].evidence[0].accession_number == "0000000002-25-000002"
    assert revenues[1].fiscal_year == 2023
    assert revenues[1].value == pytest.approx(80.0)
    assert result.latest("free_cash_flow") is None

    warning_codes = {warning.code for warning in result.warnings}
    assert "restated_fact_selected" in warning_codes
    assert "amended_filing_selected" in warning_codes
    assert "alternative_concept_conflict" in warning_codes
    assert "conflicting_unit_rejected" in warning_codes
    assert "incomplete_calculation" in warning_codes
    assert any(
        rejected.unit == "EUR" and rejected.metric == "revenue"
        for rejected in result.rejected_facts
    )


def test_generic_annual_report_url_is_rejected_as_provenance() -> None:
    document = replace(
        technology_company(),
        source_url="https://www.sec.gov/edgar/browse/?CIK=320193",
    )

    with pytest.raises(SecDataError, match="direct SEC CIK endpoint"):
        normalize_company_facts(document)
