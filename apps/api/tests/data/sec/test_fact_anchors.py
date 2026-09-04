"""Fact-level filing anchors: located exactly, or not at all."""
from dataclasses import replace
from datetime import datetime, timezone

from app.data.sec.fact_anchors import annotate_filing_anchors, filing_fact_index
from app.data.sec.models import (
    EvidenceReference, FilingDocument, FilingMetadata, NormalizationResult, NormalizedFact,
)

NOW = datetime(2026, 8, 31, tzinfo=timezone.utc)
CIK = "0000320193"
ACCESSION = "0000320193-25-000079"
DOCUMENT = "aapl-20250927.htm"
URL = f"https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/{DOCUMENT}"
OCF = "us-gaap:NetCashProvidedByUsedInOperatingActivities"
CAPEX = "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"
SHARES = "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"

HEADER = """<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"
 xmlns:xbrli="http://www.xbrl.org/2003/instance"
 xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
<head><title>Annual report</title></head><body>
<ix:header><ix:resources>
<xbrli:context id="c-1"><xbrli:entity>
<xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier>
</xbrli:entity><xbrli:period>
<xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate>
</xbrli:period></xbrli:context>
<xbrli:context id="c-seg"><xbrli:entity>
<xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier>
<xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis"
 xmlns:xbrldi="http://xbrl.org/2006/xbrldi">aapl:IPhoneMember</xbrldi:explicitMember></xbrli:segment>
</xbrli:entity><xbrli:period>
<xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate>
</xbrli:period></xbrli:context>
<xbrli:context id="c-other"><xbrli:entity>
<xbrli:identifier scheme="http://www.sec.gov/CIK">0000999999</xbrli:identifier>
</xbrli:entity><xbrli:period>
<xbrli:startDate>2024-09-29</xbrli:startDate><xbrli:endDate>2025-09-27</xbrli:endDate>
</xbrli:period></xbrli:context>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
</ix:resources>
<ix:hidden>
<ix:nonFraction unitRef="usd" contextRef="c-1" name="us-gaap:GrossProfit"
 format="ixt:num-dot-decimal" scale="6" id="f-hidden">200,000</ix:nonFraction>
</ix:hidden>
</ix:header>
"""

BODY = """
<p>Consolidated Statements of Cash Flows</p>
<ix:nonFraction unitRef="usd" contextRef="c-1" name="us-gaap:NetCashProvidedByUsedInOperatingActivities"
 format="ixt:num-dot-decimal" scale="6" id="f-307">111,482</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-1" sign="-" name="us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"
 format="ixt:num-dot-decimal" scale="6" id="f-319">12,715</ix:nonFraction>
<ix:nonFraction unitRef="shares" contextRef="c-1" name="us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"
 format="ixt:num-dot-decimal" scale="3" id="f-126">14,948,000</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-seg" name="us-gaap:Revenues"
 format="ixt:num-dot-decimal" scale="6" id="f-seg">209,000</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-other" name="us-gaap:Revenues"
 format="ixt:num-dot-decimal" scale="6" id="f-other">1,000</ix:nonFraction>
<ix:nonFraction unitRef="usd" contextRef="c-1" name="us-gaap:GrossProfit"
 format="ixt:num-dot-decimal" scale="6" id="1-bad-id">200,000</ix:nonFraction>
</body></html>
"""


def document(content=HEADER + BODY, **overrides):
    metadata = FilingMetadata(
        CIK, ACCESSION, "10-K", "2025-10-31", "2025-09-27", "0927", DOCUMENT, False, URL,
    )
    return FilingDocument(replace(metadata, **overrides), content, "text/html", NOW)


def reference(concept, value, *, unit="USD", accession=ACCESSION):
    return EvidenceReference(
        evidence_id=f"ev-{concept}", provider="SEC EDGAR", cik=CIK,
        accession_number=accession, filing_form="10-K", filing_date="2025-10-31",
        fiscal_period="FY", xbrl_concept=concept, unit=unit, raw_value=value,
        normalized_value=abs(value), transformation="reported_value",
        source_url="https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        retrieved_at=NOW,
    )


def result(*references, metric="free_cash_flow", period=("2024-09-29", "2025-09-27")):
    fact = NormalizedFact(
        metric=metric, fiscal_year=2025, fiscal_period="FY", period_start=period[0],
        period_end=period[1], unit="USD", value=98_767_000_000.0, quality="calculated",
        evidence=references,
    )
    return NormalizationResult(
        cik=CIK, source_url="https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        retrieved_at=NOW, facts={metric: (fact,)}, missing_metrics=(), warnings=(),
        rejected_facts=(),
    )


def anchors(annotated, metric="free_cash_flow"):
    return [r.filing_anchor for r in annotated.facts[metric][0].evidence]


def test_locates_each_figure_in_the_filing_it_came_from():
    annotated = annotate_filing_anchors(
        result(reference(OCF, 111_482_000_000.0), reference(CAPEX, 12_715_000_000.0)),
        document(),
    )
    assert anchors(annotated) == ["f-307", "f-319"]


def test_a_negative_presentation_is_the_same_line_item():
    """The cash-flow statement prints capital expenditure as a negative; Company
    Facts stores it as a positive. Both describe the same row."""
    annotated = annotate_filing_anchors(result(reference(CAPEX, 12_715_000_000.0)), document())
    assert anchors(annotated) == ["f-319"]


def test_shares_are_matched_on_their_own_unit():
    annotated = annotate_filing_anchors(
        result(reference(SHARES, 14_948_000_000.0, unit="shares"), metric="diluted_average_shares"),
        document(),
    )
    assert anchors(annotated, "diluted_average_shares") == ["f-126"]


def test_a_unit_that_disagrees_is_not_the_same_fact():
    annotated = annotate_filing_anchors(
        result(reference(SHARES, 14_948_000_000.0, unit="USD")), document(),
    )
    assert anchors(annotated) == [None]


def test_a_figure_that_does_not_match_is_left_unanchored():
    annotated = annotate_filing_anchors(result(reference(OCF, 99_000_000_000.0)), document())
    assert anchors(annotated) == [None]


def test_a_hidden_fact_is_never_anchored():
    """Facts in ix:hidden have ids but no layout, so the link would scroll nowhere."""
    annotated = annotate_filing_anchors(
        result(reference("us-gaap:GrossProfit", 200_000_000_000.0)), document(),
    )
    assert anchors(annotated) == [None]


def test_a_dimensioned_context_is_not_the_company_total():
    annotated = annotate_filing_anchors(
        result(reference("us-gaap:Revenues", 209_000_000_000.0)), document(),
    )
    assert anchors(annotated) == [None]


def test_another_filers_context_is_ignored():
    annotated = annotate_filing_anchors(
        result(reference("us-gaap:Revenues", 1_000_000_000.0)), document(),
    )
    assert anchors(annotated) == [None]


def test_an_unusable_id_is_dropped_rather_than_escaped():
    index = filing_fact_index(document(), CIK)
    assert not any(fact.anchor == "1-bad-id" for facts in index.values() for fact in facts)


def test_a_figure_from_an_older_filing_keeps_no_anchor():
    """The drawer links to the latest filing; an id from another one points at
    nothing here, or at a different number that happens to share it."""
    annotated = annotate_filing_anchors(
        result(reference(OCF, 111_482_000_000.0, accession="0000320193-24-000123")),
        document(),
    )
    assert anchors(annotated) == [None]


def test_refuses_a_document_that_is_not_the_filing_it_claims_to_be():
    unchanged = result(reference(OCF, 111_482_000_000.0))
    for overrides in (
        {"cik": "0000789019"},
        {"filing_form": "8-K"},
        {"filing_url": "https://www.sec.gov/Archives/edgar/data/320193/other.htm"},
        {"primary_document": "other.htm"},
    ):
        assert annotate_filing_anchors(unchanged, document(**overrides)) is unchanged


def test_refuses_a_document_with_no_retrieval_instant():
    unchanged = result(reference(OCF, 111_482_000_000.0))
    naive = replace(document(), retrieved_at=datetime(2026, 8, 31))
    assert annotate_filing_anchors(unchanged, naive) is unchanged


def test_a_filing_with_no_tagged_facts_changes_nothing():
    unchanged = result(reference(OCF, 111_482_000_000.0))
    assert annotate_filing_anchors(unchanged, document("<html><body>No facts.</body></html>")) is unchanged


# ── the pipeline ─────────────────────────────────────────────────────────────

COMPANY_FACTS = {
    "cik": 320193,
    "entityName": "Apple Inc.",
    "facts": {
        "us-gaap": {
            "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [{
                "form": "10-K", "fp": "FY", "start": "2024-09-29", "end": "2025-09-27",
                "filed": "2025-10-31", "val": 111482000000, "accn": ACCESSION,
            }]}},
            "PaymentsToAcquirePropertyPlantAndEquipment": {"units": {"USD": [{
                "form": "10-K", "fp": "FY", "start": "2024-09-29", "end": "2025-09-27",
                "filed": "2025-10-31", "val": 12715000000, "accn": ACCESSION,
            }]}},
        },
    },
}


def _service(get_filing):
    from types import SimpleNamespace

    from app.data.market.models import MarketPrice, QuoteUnavailableReason
    from app.data.sec.models import CompanySubmissionProfile, SecJsonDocument, TickerResolution
    from app.services.analysis import AnalysisService, _UnavailableGeminiProvider
    from app.services.cache import MemoryCache

    cache = lambda: MemoryCache(max_entries=4, ttl_seconds=60)
    return AnalysisService(
        sec=SimpleNamespace(
            resolve_ticker=lambda ticker: TickerResolution("AAPL", CIK, "Apple Inc."),
            get_company_facts=lambda cik: SecJsonDocument(
                f"https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json", NOW, COMPANY_FACTS,
            ),
            get_submission_profile=lambda cik: CompanySubmissionProfile(
                CIK, "Apple Inc.", 3571, "Computers", "0927", (document().metadata,),
            ),
            get_latest_10k_for_cik=get_filing,
        ),
        provider=_UnavailableGeminiProvider(), normalized_cache=cache(),
        deterministic_cache=cache(), analysis_cache=cache(),
        prices=SimpleNamespace(price_for=lambda ticker: MarketPrice.unavailable(
            QuoteUnavailableReason.PROVIDER_DISABLED, "No quote requested in this test.",
        )),
    )


def test_the_pipeline_anchors_an_ordinary_company_with_one_download():
    calls = []

    def get_filing(cik):
        calls.append(cik)
        return document()

    loaded = _service(get_filing)._load_company("AAPL")
    assert calls == [CIK]
    assert anchors(loaded.normalized) == ["f-307", "f-319"]


def test_a_filing_we_cannot_read_costs_the_link_and_nothing_else():
    def get_filing(cik):
        raise RuntimeError("SEC is unreachable")

    loaded = _service(get_filing)._load_company("AAPL")
    assert loaded.normalized.latest("free_cash_flow").value == 98_767_000_000
    assert anchors(loaded.normalized) == [None, None]
