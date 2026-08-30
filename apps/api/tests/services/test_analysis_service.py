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
from app.services.analysis import (
    AnalysisCore,
    AnalysisEnvelope,
    AnalysisService,
    CompanyData,
    normalize_ticker,
)
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


def _service(prices: object | None = None) -> AnalysisService:
    return AnalysisService(
        sec=SimpleNamespace(),
        provider=SimpleNamespace(),
        normalized_cache=_cache(),
        deterministic_cache=_cache(),
        analysis_cache=_cache(),
        prices=prices,
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

    assert first.core is second.core
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


def test_market_price_is_never_served_from_the_analysis_cache(monkeypatch) -> None:
    """The regression test for the whole envelope split.

    The expensive work is cached for CACHE_TTL_SECONDS; the quote is not. If a
    price ever rides along on the cached object again, the second analyze hands
    back a fifteen-minute-old quote and this fails.
    """
    company = _company()
    sec_calls = 0
    analysis_calls = 0
    served: list[float] = []

    class _MovingPrices:
        """A price that is different on every call, as a real market is."""

        def price_for(self, ticker: str) -> float:
            served.append(100.0 + len(served))
            return served[-1]

    def load(ticker):
        nonlocal sec_calls
        sec_calls += 1
        return company

    def prepare(_input):
        return object()

    def run(_input, _provider, *, deterministic):
        nonlocal analysis_calls
        analysis_calls += 1
        return SimpleNamespace(status=AiAnalysisStatus.APPLIED, fallback_reason=None)

    service = _service(prices=_MovingPrices())
    monkeypatch.setattr(service, "_load_company", load)
    monkeypatch.setattr(module, "_build_analysis_input", lambda company: object())
    monkeypatch.setattr(module, "prepare_deterministic_analysis", prepare)
    monkeypatch.setattr(module, "run_qualitative_analysis", run)

    first = service.analyze("AAPL")
    second = service.analyze("aapl")

    assert sec_calls == 1
    assert analysis_calls == 1
    assert first.core is second.core
    assert (first.market_price, second.market_price) == (100.0, 101.0)


def test_envelope_dict_spreads_the_core_flat_and_stays_a_superset() -> None:
    core = AnalysisCore(
        ticker="AAPL",
        cik="0000320193",
        company_name="Apple Inc.",
        sec_retrieved_at=datetime(2026, 8, 29, tzinfo=timezone.utc),
        latest_filing=None,
        missing_metrics=(),
        normalization_warnings=(),
        analysis=None,
    )

    bare = AnalysisEnvelope(core).to_dict()

    assert bare["ticker"] == "AAPL"
    assert "core" not in bare
    # No quote provider wired yet, so the two v3 keys are absent -- which
    # docs/API.md v3 requires to degrade exactly as status UNAVAILABLE does.
    assert "market_price" not in bare
    assert "plausibility" not in bare

    priced = AnalysisEnvelope(
        core,
        {"status": "AVAILABLE"},
        {"level": "SOUND", "can_state_verdict": True},
    ).to_dict()

    assert set(priced) == set(bare) | {"market_price", "plausibility"}
    assert priced["market_price"] == {"status": "AVAILABLE"}
    assert priced["plausibility"]["can_state_verdict"] is True


def test_a_quote_failure_cannot_take_the_analysis_down_with_it(monkeypatch) -> None:
    """price_for never raises by contract, so a service that breaks it is a bug
    in the price lane -- but the analysis half must still be intact and cached.
    """
    company = _company()

    class _BrokenPrices:
        def price_for(self, ticker: str) -> float:
            raise RuntimeError("quote gateway exploded")

    service = _service(prices=_BrokenPrices())
    monkeypatch.setattr(service, "_load_company", lambda ticker: company)
    monkeypatch.setattr(module, "_build_analysis_input", lambda company: object())
    monkeypatch.setattr(module, "prepare_deterministic_analysis", lambda _i: object())
    monkeypatch.setattr(
        module,
        "run_qualitative_analysis",
        lambda _i, _p, *, deterministic: SimpleNamespace(
            status=AiAnalysisStatus.APPLIED, fallback_reason=None
        ),
    )

    try:
        service.analyze("AAPL")
    except RuntimeError:
        pass
    else:
        raise AssertionError("a broken price gateway should surface, not be swallowed")

    # The expensive work still landed in the cache: the flight completed before
    # the quote was ever asked for.
    assert service._analysis_cache.get("AAPL") is not None
