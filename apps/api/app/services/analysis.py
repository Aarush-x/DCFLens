from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any, Protocol

from app.ai.gemini import GeminiClient, GeminiClientConfig, GeminiProviderError
from app.ai.models import (
    AiAnalysisInput,
    AiAnalysisResult,
    AiAnalysisStatus,
    AnalysisEvidence,
    DeterministicAnalysis,
    QualitativeProvider,
)
from app.ai.service import prepare_deterministic_analysis, run_qualitative_analysis
from app.checklist.models import ChecklistInput, QualitativeChecklistFacts
from app.core.settings import Settings
from app.data.sec import (
    CompanySubmissionProfile,
    NormalizationResult,
    SecClient,
    SecClientConfig,
    SecDataError,
    SecRequestError,
    TickerResolution,
    normalize_company_facts,
)
from app.valuation.adaptive import CompanyProfile, classify_company
from app.valuation.models import DcfInput, DcfValidationError, SensitivityConfig
from app.services.cache import CacheBackend, MemoryCache, SingleFlight
from app.services.errors import (
    CalculationError,
    InvalidTickerError,
    MissingSecDataError,
    ProviderRateLimitError,
    SecProviderError,
    UnsupportedTickerError,
)


logger = logging.getLogger(__name__)
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9-]{0,9}$")


class SecGateway(Protocol):
    def resolve_ticker(self, ticker: str) -> TickerResolution: ...

    def get_company_facts(self, cik: str | int) -> Any: ...

    def get_submission_profile(
        self, cik: str | int
    ) -> CompanySubmissionProfile: ...


@dataclass(frozen=True, slots=True)
class CompanyData:
    resolution: TickerResolution
    profile: CompanySubmissionProfile
    normalized: NormalizationResult


@dataclass(frozen=True, slots=True)
class AnalysisEnvelope:
    ticker: str
    cik: str
    company_name: str
    sec_retrieved_at: datetime
    latest_filing: dict[str, Any] | None
    missing_metrics: tuple[str, ...]
    normalization_warnings: tuple[dict[str, Any], ...]
    analysis: AiAnalysisResult

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class _UnavailableGeminiProvider:
    def generate(self, request: object) -> str:
        raise GeminiProviderError(
            "Gemini is not configured",
            fallback_reason="provider_not_configured",
        )


class AnalysisService:
    """Orchestrate SEC, deterministic domains, and bounded qualitative analysis."""

    def __init__(
        self,
        *,
        sec: SecGateway,
        provider: QualitativeProvider,
        normalized_cache: CacheBackend[str, CompanyData],
        deterministic_cache: CacheBackend[str, DeterministicAnalysis],
        analysis_cache: CacheBackend[str, AnalysisEnvelope],
        singleflight: SingleFlight[str, AnalysisEnvelope] | None = None,
    ) -> None:
        self._sec = sec
        self._provider = provider
        self._normalized_cache = normalized_cache
        self._deterministic_cache = deterministic_cache
        self._analysis_cache = analysis_cache
        self._singleflight = singleflight or SingleFlight()

    def analyze(self, raw_ticker: str) -> AnalysisEnvelope:
        ticker = normalize_ticker(raw_ticker)
        cached = self._analysis_cache.get(ticker)
        if cached is not None:
            return cached
        return self._singleflight.run(ticker, lambda: self._analyze_uncached(ticker))

    def _analyze_uncached(self, ticker: str) -> AnalysisEnvelope:
        cached = self._analysis_cache.get(ticker)
        if cached is not None:
            return cached

        company = self._load_company(ticker)
        analysis_input = _build_analysis_input(company)
        deterministic_key = (
            f"{ticker}:{company.normalized.retrieved_at.isoformat()}"
        )
        deterministic = self._deterministic_cache.get(deterministic_key)
        if deterministic is None:
            try:
                deterministic = prepare_deterministic_analysis(analysis_input)
            except (ValueError, DcfValidationError) as exc:
                logger.warning(
                    "deterministic_analysis_rejected",
                    extra={"ticker": ticker, "error_type": type(exc).__name__},
                )
                raise CalculationError(
                    "Available SEC facts could not produce a valid deterministic valuation"
                ) from exc
            self._deterministic_cache.set(deterministic_key, deterministic)

        result = run_qualitative_analysis(
            analysis_input,
            self._provider,
            deterministic=deterministic,
        )
        latest_filing = (
            asdict(company.profile.filings[0]) if company.profile.filings else None
        )
        envelope = AnalysisEnvelope(
            ticker=ticker,
            cik=company.resolution.cik,
            company_name=company.resolution.company_name,
            sec_retrieved_at=company.normalized.retrieved_at,
            latest_filing=latest_filing,
            missing_metrics=company.normalized.missing_metrics,
            normalization_warnings=tuple(
                asdict(warning) for warning in company.normalized.warnings
            ),
            analysis=result,
        )
        if result.status is AiAnalysisStatus.APPLIED:
            self._analysis_cache.set(ticker, envelope)
        else:
            logger.info(
                "analysis_completed_with_deterministic_fallback",
                extra={"ticker": ticker, "fallback_reason": result.fallback_reason},
            )
        return envelope

    def _load_company(self, ticker: str) -> CompanyData:
        cached = self._normalized_cache.get(ticker)
        if cached is not None:
            return cached
        try:
            resolution = self._sec.resolve_ticker(ticker)
            document = self._sec.get_company_facts(resolution.cik)
            profile = self._sec.get_submission_profile(resolution.cik)
            normalized = normalize_company_facts(document)
        except SecRequestError as exc:
            if exc.status_code == 429:
                raise ProviderRateLimitError("SEC EDGAR rate limit reached") from exc
            if exc.status_code == 404:
                raise MissingSecDataError(
                    "SEC EDGAR does not provide the required company data"
                ) from exc
            raise SecProviderError("SEC EDGAR is temporarily unavailable") from exc
        except SecDataError as exc:
            if "ticker not found" in str(exc):
                raise UnsupportedTickerError(
                    f"Ticker {ticker} is not present in the SEC company mapping"
                ) from exc
            raise MissingSecDataError(
                "SEC EDGAR returned incomplete or unsupported company data"
            ) from exc
        result = CompanyData(
            resolution=resolution,
            profile=profile,
            normalized=normalized,
        )
        self._normalized_cache.set(ticker, result)
        return result


def normalize_ticker(raw_ticker: str) -> str:
    ticker = raw_ticker.strip().upper().replace(".", "-")
    if not TICKER_PATTERN.fullmatch(ticker):
        raise InvalidTickerError(
            "Ticker must begin with a letter and contain at most 10 letters, numbers, or hyphens"
        )
    return ticker


def _build_analysis_input(company: CompanyData) -> AiAnalysisInput:
    normalized = company.normalized
    latest_fcf = normalized.latest("free_cash_flow")
    if latest_fcf is None:
        raise MissingSecDataError("Required SEC valuation facts are missing: free_cash_flow")

    def annual_fact(metric: str, *, duration: bool = False):
        return next((
            fact for fact in normalized.facts.get(metric, ())
            if fact.period_end == latest_fcf.period_end
            and (not duration or fact.period_start == latest_fcf.period_start)
        ), None)

    debt = annual_fact("total_debt")
    cash = annual_fact("cash_and_short_term_investments")
    shares = annual_fact("diluted_average_shares", duration=True)
    if shares is None:
        # Cover-page shares may be dated after fiscal year-end. Accept only
        # observations from the associated annual filing window, not old years.
        fcf_end = date.fromisoformat(latest_fcf.period_end)
        shares = next((
            fact for fact in normalized.facts.get("current_shares_outstanding", ())
            if 0 <= (date.fromisoformat(fact.period_end) - fcf_end).days <= 120
        ), None)
    missing: list[str] = []
    for name, fact in (
        ("free_cash_flow", latest_fcf),
        ("total_debt", debt),
        ("cash_and_short_term_investments", cash),
        ("diluted_or_current_shares", shares),
    ):
        if fact is None:
            missing.append(name)
    if missing:
        raise MissingSecDataError(
            f"Required SEC valuation facts are missing for {latest_fcf.period_end}: "
            + ", ".join(missing)
        )
    assert latest_fcf is not None and debt is not None and cash is not None and shares is not None
    if shares.value <= 0:
        raise MissingSecDataError(
            "Required SEC share count is zero or negative"
        )

    profile = CompanyProfile(
        sic_code=company.profile.sic_code,
        sic_description=company.profile.sic_description,
        business_description=company.profile.sic_description,
        years_public=None,
        evidence_references=tuple(
            evidence
            for fact in (latest_fcf, debt, cash, shares)
            for evidence in fact.evidence
        ),
    )
    classification = classify_company(profile)
    checklist_input = ChecklistInput(
        normalized_facts=normalized,
        sector=classification.sector,
        business_type=classification.business_type,
        qualitative=QualitativeChecklistFacts(),
    )
    historical_fcf = tuple(
        fact.value
        for fact in sorted(
            normalized.facts.get("free_cash_flow", ()),
            key=lambda item: item.period_end,
        )
    )
    return AiAnalysisInput(
        company_profile=profile,
        dcf_input=DcfInput(
            starting_free_cash_flow=latest_fcf.value,
            net_debt=debt.value - cash.value,
            diluted_shares=shares.value,
            currency=latest_fcf.unit,
            # The DCF stability statistic needs two observations. Keep the one
            # real annual fact in normalized evidence/adaptive coverage, but do
            # not invent history or prevent a prior-backed current valuation.
            historical_free_cash_flows=historical_fcf if len(historical_fcf) >= 2 else (),
        ),
        sensitivity=SensitivityConfig(
            growth_rate_delta=0.01,
            discount_rate_delta=0.01,
        ),
        checklist_input=checklist_input,
        evidence=_analysis_evidence(normalized),
    )


def _analysis_evidence(
    normalized: NormalizationResult,
) -> tuple[AnalysisEvidence, ...]:
    evidence_by_id: dict[str, AnalysisEvidence] = {}
    for metric in sorted(normalized.facts):
        for fact in normalized.facts[metric][:3]:
            for reference in fact.evidence:
                if reference.evidence_id in evidence_by_id:
                    continue
                evidence_by_id[reference.evidence_id] = AnalysisEvidence(
                    evidence_id=reference.evidence_id,
                    source_type="sec_company_fact",
                    content=(
                        f"{metric} for {fact.fiscal_period} {fact.fiscal_year} "
                        f"is {fact.value} {fact.unit}; {reference.transformation}."
                    ),
                    source_url=reference.source_url,
                    reference=reference,
                    is_untrusted_text=False,
                )
                if len(evidence_by_id) == 64:
                    return tuple(evidence_by_id.values())
    return tuple(evidence_by_id.values())


def build_analysis_service(settings: Settings) -> AnalysisService:
    sec = SecClient(
        SecClientConfig(
            user_agent=settings.sec_identity,
            timeout_seconds=float(settings.sec_timeout_seconds),
            max_retries=settings.sec_max_retries,
            cache_ttl_seconds=float(settings.cache_ttl_seconds),
            cache_max_entries=min(settings.cache_max_entries, 512),
        )
    )
    provider: QualitativeProvider
    if settings.google_api_key:
        provider = GeminiClient(
            GeminiClientConfig(
                api_key=settings.google_api_key,
                model=settings.gemini_model,
                timeout_seconds=float(settings.gemini_timeout_seconds),
            )
        )
    else:
        logger.warning(
            "gemini_not_configured",
            extra={"gemini_model": settings.gemini_model},
        )
        provider = _UnavailableGeminiProvider()
    cache_args = {
        "max_entries": settings.cache_max_entries,
        "ttl_seconds": float(settings.cache_ttl_seconds),
    }
    return AnalysisService(
        sec=sec,
        provider=provider,
        normalized_cache=MemoryCache(**cache_args),
        deterministic_cache=MemoryCache(**cache_args),
        analysis_cache=MemoryCache(**cache_args),
    )
