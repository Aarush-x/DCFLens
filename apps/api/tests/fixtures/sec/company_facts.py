from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.data.sec.models import SecJsonDocument


RETRIEVED_AT = datetime(2026, 8, 29, 12, 0, tzinfo=timezone.utc)


def _annual(
    value: float,
    *,
    end: str = "2024-12-31",
    start: str = "2024-01-01",
    filed: str = "2025-02-15",
    accession: str = "0000000000-25-000001",
    form: str = "10-K",
    fiscal_year: int = 2024,
) -> dict[str, Any]:
    return {
        "start": start,
        "end": end,
        "val": value,
        "accn": accession,
        "fy": fiscal_year,
        "fp": "FY",
        "form": form,
        "filed": filed,
    }


def _instant(
    value: float,
    *,
    end: str = "2024-12-31",
    filed: str = "2025-02-15",
    accession: str = "0000000000-25-000001",
    form: str = "10-K",
    fiscal_year: int = 2024,
) -> dict[str, Any]:
    return {
        "end": end,
        "val": value,
        "accn": accession,
        "fy": fiscal_year,
        "fp": "FY",
        "form": form,
        "filed": filed,
    }


def _concept(unit: str, *facts: dict[str, Any]) -> dict[str, Any]:
    return {"units": {unit: list(facts)}}


def _document(
    cik: int,
    *,
    us_gaap: dict[str, Any],
    dei: dict[str, Any] | None = None,
) -> SecJsonDocument:
    normalized_cik = str(cik).zfill(10)
    return SecJsonDocument(
        source_url=(
            "https://data.sec.gov/api/xbrl/companyfacts/"
            f"CIK{normalized_cik}.json"
        ),
        retrieved_at=RETRIEVED_AT,
        payload={
            "cik": cik,
            "entityName": "Synthetic fixture company",
            "facts": {"us-gaap": us_gaap, "dei": dei or {}},
        },
    )


def technology_company() -> SecJsonDocument:
    current_accession = "0000320193-25-000001"
    comparative_accession = "0000320193-24-000001"
    revenue_2024 = _annual(400_000.0, accession=current_accession)
    revenue_2023 = _annual(
        360_000.0,
        start="2023-01-01",
        end="2023-12-31",
        filed="2024-02-15",
        accession=comparative_accession,
        fiscal_year=2023,
    )
    us_gaap = {
        "RevenueFromContractWithCustomerExcludingAssessedTax": _concept(
            "USD", revenue_2024, dict(revenue_2024), revenue_2023
        ),
        "GrossProfit": _concept("USD", _annual(180_000.0, accession=current_accession)),
        "NetIncomeLoss": _concept("USD", _annual(95_000.0, accession=current_accession)),
        "EarningsPerShareDiluted": _concept(
            "USD/shares", _annual(6.25, accession=current_accession)
        ),
        "WeightedAverageNumberOfDilutedSharesOutstanding": _concept(
            "shares", _annual(15_200.0, accession=current_accession)
        ),
        "NetCashProvidedByUsedInOperatingActivities": _concept(
            "USD", _annual(120_000.0, accession=current_accession)
        ),
        "PaymentsToAcquirePropertyPlantAndEquipment": _concept(
            "USD", _annual(14_000.0, accession=current_accession)
        ),
        "LongTermDebtAndFinanceLeaseObligations": _concept(
            "USD", _instant(105_000.0, accession=current_accession)
        ),
        "CashCashEquivalentsAndShortTermInvestments": _concept(
            "USD", _instant(70_000.0, accession=current_accession)
        ),
        "InventoryNet": _concept(
            "USD", _instant(7_000.0, accession=current_accession)
        ),
        "AccountsReceivableNetCurrent": _concept(
            "USD", _instant(34_000.0, accession=current_accession)
        ),
        "StockholdersEquity": _concept(
            "USD", _instant(62_000.0, accession=current_accession)
        ),
        "Assets": _concept(
            "USD", _instant(365_000.0, accession=current_accession)
        ),
    }
    dei = {
        "EntityCommonStockSharesOutstanding": _concept(
            "shares", _instant(15_000.0, accession=current_accession)
        )
    }
    return _document(320193, us_gaap=us_gaap, dei=dei)


def apple_marketable_securities_company() -> SecJsonDocument:
    accession = "0000320193-25-000079"
    us_gaap = {
        "CashAndCashEquivalentsAtCarryingValue": _concept(
            "USD", _instant(35_934.0, accession=accession)
        ),
        "MarketableSecuritiesCurrent": _concept(
            "USD", _instant(35_228.0, accession=accession)
        ),
    }
    return _document(320193, us_gaap=us_gaap)


def retail_company() -> SecJsonDocument:
    accession = "0000104169-25-000001"
    us_gaap = {
        "SalesRevenueNet": _concept("USD", _annual(650_000.0, accession=accession)),
        "GrossProfit": _concept("USD", _annual(160_000.0, accession=accession)),
        "NetIncomeLoss": _concept("USD", _annual(18_000.0, accession=accession)),
        "InventoryNet": _concept("USD", _instant(58_000.0, accession=accession)),
        "AccountsReceivableNetCurrent": _concept(
            "USD", _instant(9_000.0, accession=accession)
        ),
        "NetCashProvidedByUsedInOperatingActivities": _concept(
            "USD", _annual(36_000.0, accession=accession)
        ),
        "PaymentsToAcquirePropertyPlantAndEquipment": _concept(
            "USD", _annual(-22_000.0, accession=accession)
        ),
        "Assets": _concept("USD", _instant(260_000.0, accession=accession)),
    }
    return _document(104169, us_gaap=us_gaap)


def bank_company() -> SecJsonDocument:
    accession = "0000886982-25-000001"
    us_gaap = {
        "Revenues": _concept("USD", _annual(90_000.0, accession=accession)),
        "ProfitLoss": _concept("USD", _annual(12_000.0, accession=accession)),
        "EarningsPerShareDiluted": _concept(
            "USD/shares", _annual(22.0, accession=accession)
        ),
        "WeightedAverageNumberOfDilutedSharesOutstanding": _concept(
            "shares", _annual(545.0, accession=accession)
        ),
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest": _concept(
            "USD", _instant(125_000.0, accession=accession)
        ),
        "Assets": _concept("USD", _instant(1_600_000.0, accession=accession)),
        "LongTermDebt": _concept("USD", _instant(285_000.0, accession=accession)),
        "CashCashEquivalentsAndShortTermInvestments": _concept(
            "USD", _instant(240_000.0, accession=accession)
        ),
    }
    return _document(886982, us_gaap=us_gaap)


def utility_company() -> SecJsonDocument:
    accession = "0000065984-25-000001"
    us_gaap = {
        "Revenues": _concept("USD", _annual(15_000.0, accession=accession)),
        "NetIncomeLoss": _concept("USD", _annual(1_500.0, accession=accession)),
        "NetCashProvidedByUsedInOperatingActivities": _concept(
            "USD", _annual(4_800.0, accession=accession)
        ),
        "PaymentsToAcquirePropertyPlantAndEquipment": _concept(
            "USD", _annual(3_700.0, accession=accession)
        ),
        "LongTermDebtCurrent": _concept(
            "USD", _instant(2_000.0, accession=accession)
        ),
        "LongTermDebtNoncurrent": _concept(
            "USD", _instant(24_000.0, accession=accession)
        ),
        "CashAndCashEquivalentsAtCarryingValue": _concept(
            "USD", _instant(800.0, accession=accession)
        ),
        "ShortTermInvestments": _concept(
            "USD", _instant(250.0, accession=accession)
        ),
        "StockholdersEquity": _concept(
            "USD", _instant(18_000.0, accession=accession)
        ),
        "Assets": _concept("USD", _instant(75_000.0, accession=accession)),
    }
    return _document(65984, us_gaap=us_gaap)


def missing_facts_company() -> SecJsonDocument:
    return _document(
        1,
        us_gaap={
            "Assets": _concept(
                "USD",
                _instant(1_000.0, accession="0000000001-25-000001"),
            )
        },
    )


def conflicting_facts_company() -> SecJsonDocument:
    original = _annual(
        100.0,
        filed="2025-02-01",
        accession="0000000002-25-000001",
    )
    amended = _annual(
        110.0,
        filed="2025-03-01",
        accession="0000000002-25-000002",
        form="10-K/A",
    )
    comparative = _annual(
        80.0,
        start="2023-01-01",
        end="2023-12-31",
        filed="2025-03-01",
        accession="0000000002-25-000002",
        form="10-K/A",
        fiscal_year=2024,
    )
    us_gaap = {
        "RevenueFromContractWithCustomerExcludingAssessedTax": {
            "units": {
                "USD": [original, amended, dict(amended), comparative],
                "EUR": [_annual(90.0, accession="0000000002-25-000001")],
            }
        },
        "Revenues": _concept(
            "USD",
            _annual(
                999.0,
                filed="2025-04-01",
                accession="0000000002-25-000003",
            ),
        ),
        "NetCashProvidedByUsedInOperatingActivities": _concept(
            "USD", _annual(50.0, accession="0000000002-25-000001")
        ),
        "PaymentsToAcquirePropertyPlantAndEquipment": _concept(
            "USD",
            _annual(
                10.0,
                start="2024-02-01",
                accession="0000000002-25-000001",
            ),
        ),
    }
    return _document(2, us_gaap=us_gaap)
