"""Offline checks using Render's real SDK and the existing financial pipeline."""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

# The normal FastAPI image deliberately does not install the workflow SDK.
pytest.importorskip("render")

from render.workflows.executor import TaskExecutor

from app import workflow
from app.ai.gemini import GeminiTimeoutError
from app.ai.schema import AI_ADJUSTMENT_BOUNDS
from app.checklist.contract import ORIGINAL_CHECKLIST
from app.services.analysis import AnalysisService
from app.services.cache import MemoryCache
from app.services.errors import MissingSecDataError, UnsupportedTickerError
from app.services.quote import MarketPriceService
from tests.fixtures.sec.company_facts import technology_company
from tests.services.test_analysis_qa import company_data


def service_with_provider(provider):
    company = company_data()
    return AnalysisService(
        sec=SimpleNamespace(
            resolve_ticker=lambda ticker: company.resolution,
            get_company_facts=lambda cik: technology_company(),
            get_submission_profile=lambda cik: company.profile,
        ),
        provider=provider,
        normalized_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        deterministic_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        analysis_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        prices=MarketPriceService(
            provider=None,
            success_cache=MemoryCache(max_entries=8, ttl_seconds=60),
            failure_cache=MemoryCache(max_entries=8, ttl_seconds=60),
        ),
    )


class EvidenceProvider:
    def generate(self, request):
        payload = json.loads(request.prompt.split("BEGIN_DCFLENS_INPUT_JSON\n")[1].split("\nEND_DCFLENS_INPUT_JSON")[0])
        evidence_id = payload["untrusted_evidence"][0]["evidence_id"]
        return json.dumps({
            "adjustments": [{
                "assumption": name, "adjustment": 0.0,
                "rationale": "Test evidence supports retaining the baseline.",
                "evidence_ids": [evidence_id], "claim_type": "ASSUMPTION",
            } for name in AI_ADJUSTMENT_BOUNDS],
            "evidence_assessment": [{
                "statement": "Test evidence is limited.", "claim_type": "INTERPRETATION",
                "support": "PARTIALLY_SUPPORTED", "evidence_ids": [evidence_id],
            }],
            "checklist_findings": [],
            "disagreement_summary": {"summary": "No adjustment.", "evidence_ids": [evidence_id]},
        })


class TimeoutProvider:
    def generate(self, request):
        raise GeminiTimeoutError("private provider detail must not escape")


@pytest.mark.parametrize("provider,status", [
    (EvidenceProvider(), "APPLIED"), (TimeoutProvider(), "DETERMINISTIC_FALLBACK"),
])
def test_real_sdk_executes_complete_pipeline(monkeypatch, caplog, provider, status):
    monkeypatch.setattr(workflow, "_build_service", lambda: service_with_provider(provider))
    executor = TaskExecutor(workflow.app._registry, SimpleNamespace())
    outcome = asyncio.run(executor._execute_task("analyze_company", ["aapl"]))
    assert outcome.error is None
    output = json.loads(json.dumps(outcome.result, allow_nan=False))
    assert output["ai_status"] == status
    result = output["result"]
    assert result["ticker"] == "AAPL"
    assert isinstance(result["sec_retrieved_at"], str)
    analysis = result["analysis"]
    assert output["ai_status"] == analysis["status"]
    assert output["fallback_reason"] == analysis["fallback_reason"]
    assert result["market_price"]["status"] == "UNAVAILABLE"
    assert result["market_price"]["unavailable_reason"] == "quote_provider_disabled"
    assert isinstance(result["plausibility"], dict)
    assert analysis["final_valuation"]["intrinsic_value_per_share"] > 0
    assert not analysis["final_valuation"]["sensitivity_interval"]["is_probability_interval"]
    assert [item["checklist_text"] for item in analysis["deterministic_checklist"]["results"]] == [item.text for item in ORIGINAL_CHECKLIST]
    if status == "APPLIED":
        assert analysis["adjustments"][0]["evidence_references"]
    if status == "DETERMINISTIC_FALLBACK":
        assert output["fallback_reason"] == "provider_timeout"
        assert analysis["final_valuation"] == analysis["baseline_valuation"]
    assert "private provider detail" not in caplog.text
    assert "private provider detail" not in json.dumps(output)


@pytest.mark.parametrize("attribute", ["status", "fallback_reason"])
def test_result_metadata_errors_stay_inside_sanitized_task_boundary(
    monkeypatch, caplog, attribute
):
    class BrokenAnalysis:
        def __getattr__(self, name):
            if name == attribute:
                raise RuntimeError("GOOGLE_API_KEY=secret private prompt")
            return "APPLIED"

    envelope = SimpleNamespace(
        core=SimpleNamespace(analysis=BrokenAnalysis()),
        to_dict=lambda: {"analysis": {}},
    )
    monkeypatch.setattr(workflow, "_build_service", lambda: SimpleNamespace(
        analyze=lambda ticker: envelope,
    ))
    outcome = asyncio.run(TaskExecutor(workflow.app._registry, SimpleNamespace())
                          ._execute_task("analyze_company", ["AAPL"]))
    assert isinstance(outcome.error, workflow.WorkflowAnalysisError)
    assert str(outcome.error) == "workflow_configuration_or_internal_error"
    assert outcome.error.__suppress_context__
    assert "secret" not in caplog.text
    assert "private prompt" not in caplog.text


@pytest.mark.parametrize("ticker", [None, 123, "", "AAPL\nInjected", "AAPL/../../", "A" * 40])
def test_invalid_inputs_do_not_construct_providers(monkeypatch, ticker):
    def forbidden():
        pytest.fail("provider construction must not happen")
    monkeypatch.setattr(workflow, "_build_service", forbidden)
    with pytest.raises(workflow.WorkflowAnalysisError, match="^invalid_ticker$"):
        workflow.run_analysis(ticker)


@pytest.mark.parametrize("error,code", [
    (UnsupportedTickerError("secret"), "unsupported_ticker"),
    (MissingSecDataError("secret"), "missing_sec_data"),
    (RuntimeError("GOOGLE_API_KEY=secret private prompt"), "workflow_configuration_or_internal_error"),
])
def test_failures_are_failed_tasks_with_sanitized_errors(monkeypatch, caplog, error, code):
    def fail():
        raise error
    monkeypatch.setattr(workflow, "_build_service", fail)
    outcome = asyncio.run(TaskExecutor(workflow.app._registry, SimpleNamespace())._execute_task("analyze_company", {"ticker": "AAPL"}))
    assert str(outcome.error) == code
    with pytest.raises(workflow.WorkflowAnalysisError, match=code):
        _ = outcome.result
    assert outcome.error.__suppress_context__
    assert "secret" not in caplog.text
    assert "private prompt" not in caplog.text


def test_registration_options_and_only_ticker_input():
    task = workflow.app._registry.get_task("analyze_company")
    assert workflow.app._registry.get_task_names() == ["analyze_company"]
    assert task.options.plan == "standard"
    assert task.options.timeout_seconds == 300
    assert task.options.retry.max_retries == 0
    assert [parameter.name for parameter in task.parameters] == ["ticker"]


def test_sdk_registration_without_secrets_or_external_calls():
    api = Path(__file__).resolve().parents[1]
    source_root = Path(workflow.__file__).resolve().parents[1]
    # An isolated interpreter ensures imports do not inherit test configuration.
    script = '''
import json, runpy, socket, sys
from render.workflows.client import UDSClient
def forbidden(*args, **kwargs):
    raise AssertionError("No network during registration")
socket.create_connection = forbidden
captured = []
async def capture(self, tasks):
    captured.append(tasks.to_dict())
UDSClient.register_tasks = capture
runpy.run_module("app.workflow", run_name="__main__")
assert "app.main" not in sys.modules
assert "app.core.settings" not in sys.modules
print(json.dumps(captured))
'''
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(source_root),
           "APP_ENV": "production", "PYTHON_DOTENV_DISABLED": "1",
           "RENDER_SDK_MODE": "register", "RENDER_SDK_SOCKET_PATH": "/unused.sock"}
    completed = subprocess.run([sys.executable, "-c", script], env=env, cwd=api,
                               capture_output=True, text=True, timeout=15)
    assert completed.returncode == 0, completed.stderr
    tasks = json.loads(completed.stdout)[0]["tasks"]
    assert tasks[0]["name"] == "analyze_company"
    assert tasks[0]["options"]["retry"]["max_retries"] == 0
