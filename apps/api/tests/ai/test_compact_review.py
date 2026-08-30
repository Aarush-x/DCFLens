"""Compact AI workload regressions; no live providers or credentials."""
import json
from dataclasses import asdict, replace
from io import BytesIO

import pytest

from app.ai.gemini import GeminiClient, GeminiClientConfig
from app.ai.models import AiAnalysisStatus, ProviderRequest
from app.ai.prompt import MAX_EVIDENCE_JSON_BYTES, build_provider_request
from app.ai.service import prepare_deterministic_analysis, run_qualitative_analysis
from app.checklist import ORIGINAL_CHECKLIST
from app.services.analysis import _analysis_evidence
from tests.ai.test_service import StaticProvider, _analysis_input, _valid_payload


def request_for(analysis_input):
    prepared = prepare_deterministic_analysis(analysis_input)
    return build_provider_request(
        prepared.baseline, prepared.valuation, prepared.checklist, analysis_input.evidence,
    )


def payload_for(request):
    return json.loads(request.prompt.split("\n", 1)[1].split("\nEND_DCFLENS_INPUT_JSON")[0])


def test_service_fact_prompt_is_smaller_and_has_a_bounded_review_scope():
    analysis_input = _analysis_input()
    evidence = _analysis_evidence(analysis_input.checklist_input.normalized_facts)
    request = request_for(replace(analysis_input, evidence=evidence))
    payload = payload_for(request)
    assert len(payload["untrusted_evidence"]) <= 16
    assert len(request.prompt.encode()) < 8764 * 0.8
    assert payload["review_scope"]["omitted_evidence_items"] == 8
    assert request.response_schema["properties"]["evidence_assessment"]["maxItems"] == 3
    assert request.response_schema["properties"]["checklist_findings"]["maxItems"] == 3


def many_evidence(content="The company reports two business lines."):
    first = _analysis_input().evidence[0]
    return (first, *(replace(
        first, evidence_id=f"item_{i}", content=content,
        reference=replace(first.reference, evidence_id=f"item_{i}"),
    ) for i in range(63)))


def test_selection_is_deterministic_preserves_sources_and_all_ten_items():
    analysis_input = _analysis_input()
    evidence = _analysis_evidence(analysis_input.checklist_input.normalized_facts)
    analysis_input = replace(analysis_input, evidence=evidence)
    before = asdict(analysis_input)
    first = request_for(analysis_input)
    assert first == request_for(analysis_input)
    payload = payload_for(first)
    assert len(payload["sources"]) == 1
    assert payload["original_checklist"] == [
        {"number": item.number, "text": item.text} for item in ORIGINAL_CHECKLIST
    ]
    assert len(payload["deterministic_checklist"]) == 10
    originals = {item.evidence_id: item for item in evidence}
    for item in payload["untrusted_evidence"]:
        original = originals[item["evidence_id"]]
        assert item["content"] == original.content
        assert payload["sources"][item["source_index"]] == original.source_url
    assert set(first.evidence_ids) == {item["evidence_id"] for item in payload["untrusted_evidence"]}
    assert asdict(analysis_input) == before
    prepared = prepare_deterministic_analysis(analysis_input)
    priority = {ref.evidence_id for trace in prepared.baseline.traces for ref in trace.evidence_references}
    assert priority.intersection(originals) <= set(first.evidence_ids)


def test_evidence_byte_budget_includes_unicode_escaping_and_metadata():
    analysis_input = replace(_analysis_input(), evidence=many_evidence("界" * 900))
    request = request_for(analysis_input)
    payload = payload_for(request)
    evidence_json = json.dumps({
        "sources": payload["sources"], "untrusted_evidence": payload["untrusted_evidence"],
    }, ensure_ascii=True, separators=(",", ":"))
    assert len(evidence_json.encode()) <= MAX_EVIDENCE_JSON_BYTES
    assert 0 < len(request.evidence_ids) < 16
    assert payload["review_scope"]["omitted_evidence_items"] == 64 - len(request.evidence_ids)
    assert payload["untrusted_evidence"][1]["content"] == "界" * 900


def test_oversized_evidence_is_omitted_not_cut_before_qualifying_text():
    analysis_input = _analysis_input(evidence_content="x" * 1100 + " However, the claim is disputed.")
    request = request_for(analysis_input)
    assert not request.evidence_ids
    provider = StaticProvider(response=json.dumps(_valid_payload()))
    result = run_qualitative_analysis(analysis_input, provider)
    assert not provider.requests
    assert result.fallback_reason == "insufficient_evidence"
    assert result.final_valuation == result.baseline_valuation


def test_real_but_omitted_evidence_id_is_rejected():
    analysis_input = replace(_analysis_input(), evidence=many_evidence())
    request = request_for(analysis_input)
    omitted = next(item.evidence_id for item in analysis_input.evidence if item.evidence_id not in request.evidence_ids)
    payload = _valid_payload()
    payload["adjustments"][0]["evidence_ids"] = [omitted]
    result = run_qualitative_analysis(analysis_input, StaticProvider(response=json.dumps(payload)))
    assert result.fallback_reason == "invalid_ai_response:unknown_evidence_id"
    assert result.final_valuation == result.baseline_valuation


def test_limited_review_is_disclosed_in_confidence_and_does_not_replace_checklist():
    analysis_input = replace(_analysis_input(), evidence=many_evidence())
    payload = _valid_payload()
    payload["checklist_findings"] = []
    result = run_qualitative_analysis(analysis_input, StaticProvider(response=json.dumps(payload)))
    assert result.status == AiAnalysisStatus.APPLIED
    support = next(item for item in result.confidence.factors if item.name == "evidence_support")
    assert support.score == pytest.approx(0.75 * 16 / 64)
    assert "25%" in support.explanation
    assert not result.checklist_qualitative_findings
    assert tuple(item.checklist_text for item in result.deterministic_checklist.results) == tuple(item.text for item in ORIGINAL_CHECKLIST)


@pytest.mark.parametrize("oversized", ["assessments", "findings", "rationale", "citations"])
def test_python_enforces_compact_output_limits(oversized):
    payload = _valid_payload()
    if oversized == "assessments":
        payload["evidence_assessment"] *= 2
    elif oversized == "findings":
        payload["checklist_findings"] *= 4
    elif oversized == "rationale":
        payload["adjustments"][0]["rationale"] = "x" * 241
    else:
        payload["adjustments"][0]["evidence_ids"] = ["filing_strategy"] * 3
    result = run_qualitative_analysis(_analysis_input(), StaticProvider(response=json.dumps(payload)))
    assert result.status == AiAnalysisStatus.DETERMINISTIC_FALLBACK
    assert result.final_valuation == result.baseline_valuation


def test_context_logs_contain_counts_not_evidence(caplog):
    with caplog.at_level("INFO", logger="app.ai.prompt"):
        request = request_for(_analysis_input(evidence_content="PRIVATE-EVIDENCE"))
    record = caplog.records[-1]
    assert record.message == "gemini_context_prepared"
    assert record.prompt_bytes == len(request.prompt.encode())
    assert record.selected_evidence_items == 1
    assert "PRIVATE-EVIDENCE" not in str(record.__dict__)


def test_older_models_do_not_receive_incompatible_thinking_controls():
    requests = []

    def opener(request, **kwargs):
        requests.append(json.loads(request.data))
        return BytesIO(b'{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}')

    client = GeminiClient(GeminiClientConfig(api_key="test-key", model="gemini-2.5-flash"), opener=opener)
    assert client.generate(ProviderRequest("system", "prompt", {})) == "{}"
    assert "thinkingConfig" not in requests[0]["generationConfig"]


def test_output_token_exhaustion_never_becomes_a_fake_success():
    requests = []

    def opener(request, **kwargs):
        requests.append(request)
        return BytesIO(json.dumps({"candidates": [{
            "content": {"parts": [{"text": '{"adjustments":['}]},
            "finishReason": "MAX_TOKENS",
        }]}).encode())

    client = GeminiClient(GeminiClientConfig(api_key="test-key"), opener=opener)
    result = run_qualitative_analysis(_analysis_input(), client)
    assert len(requests) == 2
    assert result.status == AiAnalysisStatus.DETERMINISTIC_FALLBACK
    assert result.fallback_reason == "invalid_ai_response:malformed_json"
    assert result.final_valuation == result.baseline_valuation


def test_wire_schema_uses_only_documented_gemini_json_schema_keywords():
    allowed = {"type", "properties", "additionalProperties", "required", "items",
               "minItems", "maxItems", "minimum", "maximum", "enum", "description"}

    def check(schema):
        assert set(schema) <= allowed
        for child in schema.get("properties", {}).values():
            check(child)
        if "items" in schema:
            check(schema["items"])

    check(request_for(_analysis_input()).response_schema)
