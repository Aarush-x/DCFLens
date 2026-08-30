from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.encoders import jsonable_encoder

from app.ai.models import AiAnalysisStatus, ConfidenceLevel
from app.data.market.errors import QuoteRequestError
from app.data.market.models import (
    MarketPrice,
    MarketQuote,
    QuoteStatus,
    QuoteUnavailableReason,
)
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
from app.services.plausibility import PlausibilityLevel, PlausibilitySignal
from app.services.quote import MarketPriceService
from app.services.errors import (
    InvalidTickerError,
    ProviderRateLimitError,
    UnsupportedTickerError,
)


def _cache():
    return MemoryCache(max_entries=8, ttl_seconds=60)


DISABLED_PRICE = MarketPrice.unavailable(
    QuoteUnavailableReason.PROVIDER_DISABLED,
    "We aren't showing a market price right now.",
)


def _quote(value: float) -> MarketPrice:
    return MarketPrice.available(
        MarketQuote(
            symbol="AAPL",
            price=value,
            currency="USD",
            quoted_at=datetime(2026, 8, 28, 20, tzinfo=timezone.utc),
            retrieved_at=datetime(2026, 8, 30, 14, tzinfo=timezone.utc),
            source="Yahoo Finance",
            source_url="https://finance.yahoo.com/quote/AAPL",
            exchange_name="NasdaqGS",
        )
    )


def _analysis_result(
    status: AiAnalysisStatus = AiAnalysisStatus.APPLIED,
    fallback_reason: str | None = None,
):
    """Shaped like AiAnalysisResult in the fields the gate actually reads.

    Full enough that assess_plausibility runs for real here rather than being
    stubbed out, which is what makes the envelope tests end-to-end.
    """
    return SimpleNamespace(
        status=status,
        fallback_reason=fallback_reason,
        confidence=SimpleNamespace(level=ConfidenceLevel.HIGH),
        final_valuation=SimpleNamespace(
            warnings=(),
            terminal_value=SimpleNamespace(concentration=0.60),
            sensitivity_interval=SimpleNamespace(
                central_value_per_share=100.0,
                lower_bound_per_share=90.0,
                upper_bound_per_share=110.0,
            ),
            intrinsic_value_per_share=100.0,
            fcf_stability=None,
        ),
    )


def _fixed_prices(price: MarketPrice = DISABLED_PRICE):
    """A quote service that never raises, exactly as the real one promises."""
    return SimpleNamespace(price_for=lambda ticker: price)


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
        prices=prices or _fixed_prices(),
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
        return _analysis_result()

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
        return _analysis_result(
            AiAnalysisStatus.DETERMINISTIC_FALLBACK, "provider_timeout"
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
        prices=_fixed_prices(),
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
        prices=_fixed_prices(),
    )

    try:
        limited_service.analyze("AAPL")
    except ProviderRateLimitError:
        pass
    else:
        raise AssertionError("SEC rate limit must be distinct")


def _stub_analysis(monkeypatch, service, company, *, on_load=None, on_run=None):
    monkeypatch.setattr(
        service, "_load_company", on_load or (lambda ticker: company)
    )
    monkeypatch.setattr(module, "_build_analysis_input", lambda company: object())
    monkeypatch.setattr(module, "prepare_deterministic_analysis", lambda _i: object())
    monkeypatch.setattr(
        module,
        "run_qualitative_analysis",
        on_run or (lambda _i, _p, *, deterministic: _analysis_result()),
    )


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

        def price_for(self, ticker: str) -> MarketPrice:
            served.append(100.0 + len(served))
            return _quote(served[-1])

    def load(ticker):
        nonlocal sec_calls
        sec_calls += 1
        return company

    def run(_input, _provider, *, deterministic):
        nonlocal analysis_calls
        analysis_calls += 1
        return _analysis_result()

    service = _service(prices=_MovingPrices())
    _stub_analysis(monkeypatch, service, company, on_load=load, on_run=run)

    first = service.analyze("AAPL")
    second = service.analyze("aapl")

    assert sec_calls == 1
    assert analysis_calls == 1
    assert first.core is second.core
    assert (first.market_price.quote.price, second.market_price.quote.price) == (
        100.0,
        101.0,
    )


def test_quote_failure_still_returns_a_full_analysis(monkeypatch) -> None:
    """A missing price is never an HTTP error and never truncates the analysis."""
    company = _company()
    service = _service(
        prices=_fixed_prices(
            MarketPrice.unavailable(
                QuoteUnavailableReason.PROVIDER_TIMEOUT,
                "The price service didn't answer in time.",
            )
        )
    )
    _stub_analysis(monkeypatch, service, company)

    envelope = service.analyze("AAPL")
    payload = envelope.to_dict()

    assert envelope.market_price.status is QuoteStatus.UNAVAILABLE
    assert payload["ticker"] == "AAPL"
    assert payload["analysis"] is not None
    # Invariant 1: absence is a status and a reason, never a missing key.
    assert payload["market_price"]["unavailable_reason"] == (
        QuoteUnavailableReason.PROVIDER_TIMEOUT
    )
    assert payload["market_price"]["quote"] is None
    assert "plausibility" in payload


def test_quote_provider_exception_does_not_break_the_analysis(monkeypatch) -> None:
    """Through a real MarketPriceService, so the bare except is exercised.

    A gateway that throws is a bug in the quote lane. It must still not turn a
    working 200 into a 500.
    """

    class _ExplodingGateway:
        def get_quote(self, ticker: str):
            raise QuoteRequestError(
                url="https://query1.finance.yahoo.com/redacted",
                message="provider exploded",
                attempts=1,
                status_code=500,
                retryable=True,
            )

    company = _company()
    service = _service(
        prices=MarketPriceService(
            provider=_ExplodingGateway(),
            success_cache=_cache(),
            failure_cache=_cache(),
        )
    )
    _stub_analysis(monkeypatch, service, company)

    envelope = service.analyze("AAPL")

    assert envelope.market_price.status is QuoteStatus.UNAVAILABLE
    assert envelope.market_price.unavailable_reason is (
        QuoteUnavailableReason.PROVIDER_UNAVAILABLE
    )
    assert envelope.core.ticker == "AAPL"


def test_envelope_dict_is_json_encodable() -> None:
    """The two v3 keys add StrEnums and datetimes; FastAPI must round-trip them."""
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
    analysis = SimpleNamespace(
        status=AiAnalysisStatus.APPLIED,
        confidence=SimpleNamespace(level=ConfidenceLevel.HIGH),
        final_valuation=SimpleNamespace(
            warnings=(),
            terminal_value=SimpleNamespace(concentration=0.60),
            sensitivity_interval=SimpleNamespace(
                central_value_per_share=100.0,
                lower_bound_per_share=90.0,
                upper_bound_per_share=110.0,
            ),
            intrinsic_value_per_share=100.0,
            fcf_stability=None,
        ),
    )
    price = _quote(96.4)
    envelope = AnalysisEnvelope(
        core, price, module.assess_plausibility(analysis, price)
    )

    encoded = jsonable_encoder(envelope.to_dict())

    assert encoded["market_price"]["status"] == "AVAILABLE"
    assert encoded["market_price"]["quote"]["price"] == 96.4
    assert encoded["market_price"]["quote"]["quoted_at"].startswith("2026-08-28")
    assert encoded["sec_retrieved_at"].startswith("2026-08-29")
    assert encoded["plausibility"]["level"] == PlausibilityLevel.SOUND
    assert encoded["plausibility"]["can_state_verdict"] is True
    assert encoded["plausibility"]["price_position"] == "in_range"


def test_a_disabled_provider_still_produces_both_v3_keys(monkeypatch) -> None:
    """The MARKET_QUOTE_ENABLED=false shape: byte-identical analysis, no price."""
    company = _company()
    service = _service()
    _stub_analysis(monkeypatch, service, company)

    payload = service.analyze("AAPL").to_dict()

    assert payload["market_price"]["unavailable_reason"] == (
        QuoteUnavailableReason.PROVIDER_DISABLED
    )
    # Invariant 4: no price means no verdict word, whatever the level says.
    assert payload["plausibility"]["can_state_verdict"] is False
    assert PlausibilitySignal.NO_MARKET_PRICE in {
        reason["signal"] for reason in payload["plausibility"]["reasons"]
    }


def _settings(**overrides):
    from app.core.settings import Settings

    return Settings.from_env({"SEC_IDENTITY": "DCFLens ops@example.com", **overrides})


def test_build_analysis_service_wires_a_quote_provider_by_default() -> None:
    """MARKET_QUOTE_USER_AGENT is an override, not a value to pass through.

    Settings reports None when it is unset, and forwarding that None to
    YahooQuoteConfig raises QuoteConfigurationError -- which the try in
    build_analysis_service swallows, silently disabling prices everywhere.
    """
    from app.services.analysis import build_analysis_service

    service = build_analysis_service(_settings())

    assert service._prices._provider is not None


def test_market_quote_enabled_false_is_the_kill_switch() -> None:
    from app.services.analysis import build_analysis_service

    service = build_analysis_service(_settings(MARKET_QUOTE_ENABLED="false"))

    assert service._prices._provider is None
    price = service._prices.price_for("AAPL")
    assert price.unavailable_reason is QuoteUnavailableReason.PROVIDER_DISABLED
