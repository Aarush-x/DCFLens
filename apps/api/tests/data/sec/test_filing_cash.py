"""NVIDIA FY2026 regression: real SEC facts and minimal inline-XBRL excerpt."""
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai.service import prepare_deterministic_analysis
from app.core.settings import Settings
from app.main import create_app
from app.data.market.models import MarketPrice, QuoteUnavailableReason
from app.data.sec.errors import SecDataError
from app.data.sec.filing_cash import METRIC, needs_filing_cash, supplement_filing_cash
from app.data.sec.models import (
    CompanySubmissionProfile, FilingDocument, FilingMetadata, SecJsonDocument, TickerResolution,
)
from app.data.sec.normalization import normalize_company_facts
from app.services.analysis import AnalysisService, CompanyData, _UnavailableGeminiProvider, _build_analysis_input
from app.services.cache import MemoryCache
from app.services.errors import MissingSecDataError

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "sec"
NOW = datetime(2026, 8, 31, tzinfo=timezone.utc)
CIK = "0001045810"
URL = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm"


def company_document():
    return SecJsonDocument(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json", NOW,
        json.loads((FIXTURES / "nvda_2026_company_facts.json").read_text()),
    )


def filing():
    return FilingDocument(
        FilingMetadata(CIK, "0001045810-26-000021", "10-K", "2026-02-25",
                       "2026-01-25", "0125", "nvda-20260125.htm", False, URL),
        (FIXTURES / "nvda_2026_cash.xhtml").read_text(), "text/html", NOW,
    )


def profile():
    return CompanySubmissionProfile(CIK, "NVIDIA CORP", 3674, "Semiconductors", "0125", (filing().metadata,))


def company(normalized):
    return CompanyData(TickerResolution("NVDA", CIK, "NVIDIA CORP"), profile(), normalized)


def test_real_company_facts_reproduce_failure_then_filing_unlocks_dcf():
    normalized = normalize_company_facts(company_document())
    assert needs_filing_cash(normalized)
    with pytest.raises(MissingSecDataError, match=METRIC):
        _build_analysis_input(company(normalized))

    supplemented = supplement_filing_cash(normalized, filing())
    cash = supplemented.latest(METRIC)
    assert cash.value == 62_556_000_000
    assert cash.period_end == "2026-01-25"
    assert cash.quality == "calculated"
    assert [e.normalized_value for e in cash.evidence] == [10_605_000_000, 51_951_000_000]
    assert all(e.source_url == URL and e.accession_number == "0001045810-26-000021" for e in cash.evidence)
    assert all("10^6" in e.transformation for e in cash.evidence)
    assert METRIC not in supplemented.missing_metrics
    assert not any(w.metric == METRIC for w in supplemented.warnings)
    inputs = _build_analysis_input(company(supplemented))
    assert inputs.dcf_input.net_debt == 8_468_000_000 - 62_556_000_000
    assert prepare_deterministic_analysis(inputs).valuation.intrinsic_value_per_share > 0
    assert {e.source_type for e in inputs.evidence if e.source_url == URL} == {"sec_inline_fact"}
    assert supplement_filing_cash(supplemented, filing()) is supplemented


@pytest.mark.parametrize("old,new", [
    ("0001045810</", "0000320193</"),  # another issuer
    ("2026-01-25</", "2025-01-26</"),  # another annual period
    ("iso4217:USD", "iso4217:EUR"),
    ("</xbrli:entity>", "<xbrli:segment/></xbrli:entity>"),
    ("</xbrli:context>", "<xbrli:scenario/></xbrli:context>"),
    ('scale="6"', 'scale="99"'),
    ('scale="6"', 'scale="6" sign="-"'),
    ('scale="6"', 'scale="6" xsi:nil="true"'),
    ("51,951", "51,95"),
    ("51,951", "NaN"),
    ("nvda:MarketableSecuritiesAndEquitySecuritiesFVNI", "us-gaap:AvailableForSaleSecuritiesDebtSecurities"),
    ("ixt:num-dot-decimal", "ixt:num-comma-decimal"),
])
def test_unsupported_facts_do_not_create_a_cash_total(old, new):
    normalized = normalize_company_facts(company_document())
    document = filing()
    document = replace(document, content=document.content.replace(old, new))
    assert supplement_filing_cash(normalized, document) is normalized


def test_conflicting_consolidated_totals_are_rejected():
    normalized = normalize_company_facts(company_document())
    document = filing()
    duplicate = '<ix:nonFraction unitRef="usd" contextRef="c-11" name="nvda:MarketableSecuritiesAndEquitySecuritiesFVNI" format="ixt:num-dot-decimal" scale="6">50,000</ix:nonFraction>'
    document = replace(document, content=document.content.replace("</body>", duplicate + "</body>"))
    assert supplement_filing_cash(normalized, document) is normalized


def test_wrong_filing_metadata_is_not_used():
    normalized = normalize_company_facts(company_document())
    document = filing()
    for change in ({"cik": "0000320193"}, {"report_date": "2025-01-26"}, {"filing_url": "https://example.com/report"}):
        wrong = replace(document, metadata=replace(document.metadata, **change))
        assert supplement_filing_cash(normalized, wrong) is normalized


def test_dtd_and_invalid_xml_are_rejected():
    normalized = normalize_company_facts(company_document())
    for content in ('<!DOCTYPE html><html/>', '<html>'):
        with pytest.raises(SecDataError):
            supplement_filing_cash(normalized, replace(filing(), content=content))


def test_service_fetches_filing_only_for_missing_supported_cash_and_caches_result():
    calls = []
    def get_filing(cik):
        calls.append(cik)
        return filing()
    cache = lambda: MemoryCache(max_entries=4, ttl_seconds=60)
    service = AnalysisService(
        sec=SimpleNamespace(
            resolve_ticker=lambda ticker: company(None).resolution,
            get_company_facts=lambda cik: company_document(),
            get_submission_profile=lambda cik: profile(),
            get_latest_10k_for_cik=get_filing,
        ),
        provider=_UnavailableGeminiProvider(), normalized_cache=cache(),
        deterministic_cache=cache(), analysis_cache=cache(),
        prices=SimpleNamespace(price_for=lambda ticker: MarketPrice.unavailable(
            QuoteUnavailableReason.PROVIDER_DISABLED, "No quote requested in this test.",
        )),
    )
    loaded = service._load_company("NVDA")
    assert loaded.normalized.latest(METRIC).value == 62_556_000_000
    assert service._load_company("NVDA") is loaded
    assert calls == [CIK]
    application = create_app(Settings.from_env({}))
    application.state.analysis_service = service
    with TestClient(application) as client:
        response = client.get("/api/analyze/NVDA")
    assert response.status_code == 200
    body = response.json()
    assert body["analysis"]["final_valuation"]["intrinsic_value_per_share"] > 0
    assert body["analysis"]["final_valuation"]["inputs"]["net_debt"] == -54_088_000_000
    assert calls == [CIK]


def test_unreviewed_issuer_does_not_trigger_filing_fallback():
    normalized = normalize_company_facts(company_document())
    assert not needs_filing_cash(replace(normalized, cik="0000320193"))
