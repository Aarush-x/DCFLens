"""Full fixture pipeline and annual-period alignment regressions."""
from dataclasses import replace
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai.models import AiAnalysisStatus
from app.ai.schema import AI_ADJUSTMENT_BOUNDS
from app.checklist.contract import ORIGINAL_CHECKLIST
from app.core.settings import Settings
from app.main import create_app
from app.data.sec import normalize_company_facts
from app.data.sec.models import CompanySubmissionProfile, TickerResolution
from app.services.analysis import AnalysisService, CompanyData, _build_analysis_input
from app.services.cache import MemoryCache
from app.services.errors import MissingSecDataError
from tests.fixtures.sec.company_facts import technology_company


def company_data():
    document = technology_company()
    return CompanyData(
        TickerResolution("AAPL", "0000320193", "Synthetic tech"),
        CompanySubmissionProfile("0000320193", "Synthetic tech", 3571, "Electronic Computers", "1231", ()),
        normalize_company_facts(document),
    )


def test_single_fcf_year_can_return_deterministic_valuation():
    company = company_data()
    assert len(company.normalized.facts["free_cash_flow"]) == 1
    sec = SimpleNamespace(
        resolve_ticker=lambda ticker: company.resolution,
        get_company_facts=lambda cik: technology_company(),
        get_submission_profile=lambda cik: company.profile,
    )
    class UnavailableProvider:
        def generate(self, request):
            raise TimeoutError("no external call")
    service = AnalysisService(
        sec=sec, provider=UnavailableProvider(),
        normalized_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        deterministic_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        analysis_cache=MemoryCache(max_entries=8, ttl_seconds=60),
    )
    result = service.analyze("aapl")
    assert result.analysis.status is AiAnalysisStatus.DETERMINISTIC_FALLBACK
    assert result.analysis.final_valuation.intrinsic_value_per_share > 0
    assert result.analysis.final_valuation.fcf_stability is None


@pytest.mark.parametrize("metric", ["total_debt", "cash_and_short_term_investments", "diluted_average_shares"])
def test_stale_required_annual_fact_does_not_mix_with_current_fcf(metric):
    company = company_data()
    facts = dict(company.normalized.facts)
    facts[metric] = (replace(facts[metric][0], period_end="2022-12-31", fiscal_year=2022),)
    # No current-share fallback is available in this case.
    facts["current_shares_outstanding"] = ()
    company = replace(company, normalized=replace(company.normalized, facts=facts))
    with pytest.raises(MissingSecDataError):
        _build_analysis_input(company)


def test_complete_sec_to_ai_to_http_pipeline_and_completed_cache():
    company = company_data()
    calls = {"sec": 0, "ai": 0}
    def get_facts(cik):
        calls["sec"] += 1
        return technology_company()
    class EvidenceBoundProvider:
        def generate(self, request):
            calls["ai"] += 1
            payload = json.loads(request.prompt.split("BEGIN_DCFLENS_INPUT_JSON\n")[1].split("\nEND_DCFLENS_INPUT_JSON")[0])
            evidence_id = payload["untrusted_evidence"][0]["evidence_id"]
            return json.dumps({
                "adjustments": [{
                    "assumption": name, "adjustment": 0.0,
                    "rationale": "Fixture evidence warrants retaining the baseline.",
                    "evidence_ids": [evidence_id], "claim_type": "ASSUMPTION",
                } for name in AI_ADJUSTMENT_BOUNDS],
                "evidence_assessment": [{
                    "statement": "Limited fixture evidence supports no qualitative adjustment.",
                    "claim_type": "INTERPRETATION", "support": "PARTIALLY_SUPPORTED",
                    "evidence_ids": [evidence_id],
                }],
                "checklist_findings": [],
                "disagreement_summary": {
                    "summary": "No qualitative adjustment was proposed.",
                    "evidence_ids": [evidence_id],
                },
            })
    service = AnalysisService(
        sec=SimpleNamespace(
            resolve_ticker=lambda ticker: company.resolution,
            get_company_facts=get_facts,
            get_submission_profile=lambda cik: company.profile,
        ), provider=EvidenceBoundProvider(),
        normalized_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        deterministic_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        analysis_cache=MemoryCache(max_entries=8, ttl_seconds=60),
    )
    application = create_app(Settings.from_env({}))
    application.state.analysis_service = service
    with TestClient(application) as client:
        response = client.get("/api/analyze/aapl")
        second = client.get("/api/analyze/AAPL")
    assert response.status_code == second.status_code == 200
    assert response.json() == second.json()
    analysis = response.json()["analysis"]
    assert analysis["status"] == "APPLIED"
    assert analysis["final_valuation"]["intrinsic_value_per_share"] > 0
    assert analysis["final_valuation"]["inputs"] == analysis["baseline_valuation"]["inputs"]
    assert not analysis["final_valuation"]["sensitivity_interval"]["is_probability_interval"]
    checklist = analysis["deterministic_checklist"]["results"]
    assert [item["checklist_text"] for item in checklist] == [item.text for item in ORIGINAL_CHECKLIST]
    assert all(item["evidence_references"] for item in analysis["adjustments"])
    assert calls == {"sec": 1, "ai": 1}


@pytest.mark.parametrize("offset, accepted", [(0, True), (60, True), (120, True), (-1, False), (121, False)])
def test_current_share_fallback_has_a_bounded_observation_window(offset, accepted):
    from datetime import date, timedelta
    company = company_data()
    facts = dict(company.normalized.facts)
    facts["diluted_average_shares"] = ()
    end = date.fromisoformat(facts["free_cash_flow"][0].period_end)
    facts["current_shares_outstanding"] = (replace(
        facts["current_shares_outstanding"][0], period_end=(end + timedelta(days=offset)).isoformat(),
    ),)
    company = replace(company, normalized=replace(company.normalized, facts=facts))
    if accepted:
        assert _build_analysis_input(company).dcf_input.diluted_shares == facts["current_shares_outstanding"][0].value
    else:
        with pytest.raises(MissingSecDataError):
            _build_analysis_input(company)
