from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.ai.models import AiAnalysisStatus
from app.data.sec.models import (
    CompanySubmissionProfile,
    NormalizationResult,
    TickerResolution,
)
from app.data.sec.errors import SecDataError, SecRequestError
from app.services import analysis as module
from app.services.analysis import AnalysisService, CompanyData, normalize_ticker
from app.services.cache import MemoryCache
from app.services.errors import (
    InvalidTickerError,
    ProviderRateLimitError,
    UnsupportedTickerError,
)


def _cache():
    return MemoryCache(max_entries=8, ttl_seconds=60)


def _company() -> CompanyData:
    now = datetime(2026, 8, 29, tzinfo=timezone.utc)
    return CompanyData(
        resolution=TickerResolution("AAPL", "0000320193", "Apple Inc."),
        profile=CompanySubmissionProfile(
            cik="0000320193",
            company_name="Apple Inc.",
            sic_code=3571,
            sic_description="Electronic Computers",
            fiscal_year_end="0928",
            filings=(),
        ),
        normalized=NormalizationResult(
            cik="0000320193",
            source_url=(
                "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"
            ),
            retrieved_at=now,
            facts={},
            missing_metrics=(),
            warnings=(),
            rejected_facts=(),
        ),
    )


def _service() -> AnalysisService:
    return AnalysisService(
        sec=SimpleNamespace(),
        provider=SimpleNamespace(),
        normalized_cache=_cache(),
        deterministic_cache=_cache(),
        analysis_cache=_cache(),
    )


def test_completed_analysis_and_deterministic_work_are_cached(monkeypatch) -> None:
    service = _service()
    company = _company()
    prepare_calls = 0
    analysis_calls = 0

    monkeypatch.setattr(service, "_load_company", lambda ticker: company)
    monkeypatch.setattr(module, "_build_analysis_input", lambda company: object())

    def prepare(_input):
        nonlocal prepare_calls
        prepare_calls += 1
        return object()

    def run(_input, _provider, *, deterministic):
        nonlocal analysis_calls
        analysis_calls += 1
        return SimpleNamespace(
            status=AiAnalysisStatus.APPLIED,
            fallback_reason=None,
        )

    monkeypatch.setattr(module, "prepare_deterministic_analysis", prepare)
    monkeypatch.setattr(module, "run_qualitative_analysis", run)

    first = service.analyze("aapl")
    second = service.analyze("AAPL")

    assert first is second
    assert prepare_calls == 1
    assert analysis_calls == 1


def test_transient_provider_fallback_is_not_cached_as_completed(monkeypatch) -> None:
    service = _service()
    company = _company()
    prepare_calls = 0
    analysis_calls = 0

    monkeypatch.setattr(service, "_load_company", lambda ticker: company)
    monkeypatch.setattr(module, "_build_analysis_input", lambda company: object())

    def prepare(_input):
        nonlocal prepare_calls
        prepare_calls += 1
        return object()

    def run(_input, _provider, *, deterministic):
        nonlocal analysis_calls
        analysis_calls += 1
        return SimpleNamespace(
            status=AiAnalysisStatus.DETERMINISTIC_FALLBACK,
            fallback_reason="provider_timeout",
        )

    monkeypatch.setattr(module, "prepare_deterministic_analysis", prepare)
    monkeypatch.setattr(module, "run_qualitative_analysis", run)

    service.analyze("AAPL")
    service.analyze("AAPL")

    assert prepare_calls == 1
    assert analysis_calls == 2


def test_ticker_normalization_is_strict_and_supports_class_shares() -> None:
    assert normalize_ticker(" brk.b ") == "BRK-B"

    for value in ("", "1AAPL", "AA PL", "AAPL/../../secret", "A" * 11):
        try:
            normalize_ticker(value)
        except InvalidTickerError:
            pass
        else:
            raise AssertionError(f"ticker should be rejected: {value!r}")


def test_sec_unknown_ticker_and_rate_limit_remain_distinct_service_errors() -> None:
    unknown_sec = SimpleNamespace(
        resolve_ticker=lambda ticker: (_ for _ in ()).throw(
            SecDataError("ticker not found in SEC mapping: NOPE")
        )
    )
    unknown_service = AnalysisService(
        sec=unknown_sec,
        provider=SimpleNamespace(),
        normalized_cache=_cache(),
        deterministic_cache=_cache(),
        analysis_cache=_cache(),
    )

    try:
        unknown_service.analyze("NOPE")
    except UnsupportedTickerError:
        pass
    else:
        raise AssertionError("unknown ticker must be distinct")

    resolution = TickerResolution("AAPL", "0000320193", "Apple Inc.")
    limited_sec = SimpleNamespace(
        resolve_ticker=lambda ticker: resolution,
        get_company_facts=lambda cik: (_ for _ in ()).throw(
            SecRequestError(
                url="https://data.sec.gov/redacted",
                message="SEC returned HTTP 429",
                attempts=3,
                status_code=429,
                retryable=True,
            )
        ),
    )
    limited_service = AnalysisService(
        sec=limited_sec,
        provider=SimpleNamespace(),
        normalized_cache=_cache(),
        deterministic_cache=_cache(),
        analysis_cache=_cache(),
    )

    try:
        limited_service.analyze("AAPL")
    except ProviderRateLimitError:
        pass
    else:
        raise AssertionError("SEC rate limit must be distinct")
