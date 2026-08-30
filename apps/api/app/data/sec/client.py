from __future__ import annotations

import json
import math
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Callable, Mapping

from app.data.sec.cache import BoundedTtlCache
from app.data.sec.errors import (
    SecConfigurationError,
    SecDataError,
    SecRequestError,
)
from app.data.sec.models import (
    CompanySubmissionProfile,
    FilingDocument,
    FilingMetadata,
    SecJsonDocument,
    TickerResolution,
)
from app.data.sec.transport import (
    HttpResponse,
    ResponseTooLarge,
    SecTransport,
    TransportFailure,
    UrllibSecTransport,
)


TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
DATA_BASE_URL = "https://data.sec.gov"
ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
EMAIL_PATTERN = re.compile(r"(?<![\w.-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])")
ACCESSION_PATTERN = re.compile(r"^\d{10}-\d{2}-\d{6}$")
PRIMARY_DOCUMENT_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True, slots=True)
class SecClientConfig:
    user_agent: str
    timeout_seconds: float = 15.0
    max_retries: int = 2
    retry_backoff_seconds: float = 0.5
    min_request_interval_seconds: float = 0.1
    max_response_bytes: int = 20_000_000
    cache_ttl_seconds: float = 900.0
    cache_max_entries: int = 32

    def __post_init__(self) -> None:
        if not isinstance(self.user_agent, str):
            raise SecConfigurationError("user_agent must be a string")
        identity = self.user_agent.strip()
        if any(ord(character) < 32 or ord(character) == 127 for character in identity):
            raise SecConfigurationError("user_agent must not contain control characters")
        try:
            identity.encode("latin-1")
        except UnicodeEncodeError as exc:
            raise SecConfigurationError("user_agent must be HTTP header encodable") from exc
        email_match = EMAIL_PATTERN.search(identity)
        app_identity = identity[: email_match.start()].strip() if email_match else ""
        if not email_match or len(app_identity) < 2:
            raise SecConfigurationError(
                "user_agent must include an application or organization name "
                "and a monitored contact email"
            )
        if not self._finite_number(self.timeout_seconds) or not (
            0.0 < self.timeout_seconds <= 120.0
        ):
            raise SecConfigurationError("timeout_seconds must be in (0, 120]")
        if (
            isinstance(self.max_retries, bool)
            or not isinstance(self.max_retries, int)
            or not 0 <= self.max_retries <= 5
        ):
            raise SecConfigurationError("max_retries must be an integer from 0 through 5")
        if not self._finite_number(self.retry_backoff_seconds) or not (
            0.0 <= self.retry_backoff_seconds <= 30.0
        ):
            raise SecConfigurationError("retry_backoff_seconds must be in [0, 30]")
        if not self._finite_number(self.min_request_interval_seconds) or (
            self.min_request_interval_seconds < 0.1
        ):
            raise SecConfigurationError(
                "min_request_interval_seconds must be at least 0.1"
            )
        if (
            isinstance(self.max_response_bytes, bool)
            or not isinstance(self.max_response_bytes, int)
            or not 1_024 <= self.max_response_bytes <= 100_000_000
        ):
            raise SecConfigurationError(
                "max_response_bytes must be between 1024 and 100000000"
            )
        if not self._finite_number(self.cache_ttl_seconds) or not (
            1.0 <= self.cache_ttl_seconds <= 86_400.0
        ):
            raise SecConfigurationError("cache_ttl_seconds must be in [1, 86400]")
        if (
            isinstance(self.cache_max_entries, bool)
            or not isinstance(self.cache_max_entries, int)
            or not 1 <= self.cache_max_entries <= 512
        ):
            raise SecConfigurationError("cache_max_entries must be in [1, 512]")

    @staticmethod
    def _finite_number(value: object) -> bool:
        return (
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(float(value))
        )


class SecClient:
    """Bounded, paced client for the SEC's public data and filing endpoints."""

    def __init__(
        self,
        config: SecClientConfig,
        *,
        transport: SecTransport | None = None,
        monotonic_clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config
        self._transport = transport or UrllibSecTransport()
        self._monotonic_clock = monotonic_clock
        self._wall_clock = wall_clock or (lambda: datetime.now(timezone.utc))
        self._sleeper = sleeper
        self._cache: BoundedTtlCache[str, SecJsonDocument | tuple[bytes, str, datetime]] = (
            BoundedTtlCache(
                max_entries=config.cache_max_entries,
                ttl_seconds=config.cache_ttl_seconds,
                clock=monotonic_clock,
            )
        )
        self._pacing_lock = threading.Lock()
        self._last_request_at: float | None = None

    def resolve_ticker(self, ticker: str) -> TickerResolution:
        normalized_ticker = ticker.strip().upper().replace(".", "-")
        if not normalized_ticker:
            raise SecDataError("ticker must not be empty")
        document = self._get_json(TICKER_MAP_URL)
        for item in document.payload.values():
            if not isinstance(item, Mapping):
                continue
            candidate = str(item.get("ticker", "")).upper()
            if candidate != normalized_ticker:
                continue
            try:
                cik = self._normalize_cik(item.get("cik_str"))
            except SecDataError:
                continue
            company_name = str(item.get("title", "")).strip()
            if not company_name:
                raise SecDataError(f"SEC ticker record for {normalized_ticker} has no title")
            return TickerResolution(
                ticker=normalized_ticker,
                cik=cik,
                company_name=company_name,
            )
        raise SecDataError(f"ticker not found in SEC mapping: {normalized_ticker}")

    def get_company_facts(self, cik: str | int) -> SecJsonDocument:
        normalized_cik = self._normalize_cik(cik)
        url = f"{DATA_BASE_URL}/api/xbrl/companyfacts/CIK{normalized_cik}.json"
        return self._get_json(url)

    def get_company_facts_for_ticker(
        self, ticker: str
    ) -> tuple[TickerResolution, SecJsonDocument]:
        resolution = self.resolve_ticker(ticker)
        return resolution, self.get_company_facts(resolution.cik)

    def get_10k_filings(self, cik: str | int) -> tuple[FilingMetadata, ...]:
        return self.get_submission_profile(cik).filings

    def get_submission_profile(self, cik: str | int) -> CompanySubmissionProfile:
        """Return SEC company classification and recent 10-K metadata."""
        normalized_cik = self._normalize_cik(cik)
        url = f"{DATA_BASE_URL}/submissions/CIK{normalized_cik}.json"
        document = self._get_json(url)
        filings = document.payload.get("filings")
        if not isinstance(filings, Mapping):
            raise SecDataError("SEC submissions response is missing filings")
        recent = filings.get("recent")
        if not isinstance(recent, Mapping):
            raise SecDataError("SEC submissions response is missing recent filings")

        forms = self._string_list(recent, "form")
        accessions = self._string_list(recent, "accessionNumber")
        filing_dates = self._string_list(recent, "filingDate")
        report_dates = self._string_list(recent, "reportDate")
        primary_documents = self._string_list(recent, "primaryDocument")
        fiscal_year_end = document.payload.get("fiscalYearEnd")
        if fiscal_year_end is not None and not isinstance(fiscal_year_end, str):
            raise SecDataError("SEC submissions fiscalYearEnd must be a string")

        required_lengths = {
            len(forms),
            len(accessions),
            len(filing_dates),
            len(report_dates),
            len(primary_documents),
        }
        if len(required_lengths) != 1:
            raise SecDataError("SEC submissions recent arrays have inconsistent lengths")

        results: list[FilingMetadata] = []
        seen_accessions: set[str] = set()
        for index, form in enumerate(forms):
            if form not in {"10-K", "10-K/A"}:
                continue
            accession = accessions[index]
            if accession in seen_accessions:
                continue
            self._validate_accession(accession)
            self._validate_iso_date(filing_dates[index], "filingDate")
            self._validate_iso_date(report_dates[index], "reportDate")
            primary_document = primary_documents[index]
            self._validate_primary_document(primary_document)
            filing_url = self._filing_url(
                normalized_cik, accession, primary_document
            )
            results.append(
                FilingMetadata(
                    cik=normalized_cik,
                    accession_number=accession,
                    filing_form=form,
                    filing_date=filing_dates[index],
                    report_date=report_dates[index],
                    fiscal_year_end=fiscal_year_end or None,
                    primary_document=primary_document,
                    is_amendment=form.endswith("/A"),
                    filing_url=filing_url,
                )
            )
            seen_accessions.add(accession)

        sorted_filings = tuple(
            sorted(
                results,
                key=lambda filing: (
                    filing.report_date or filing.filing_date,
                    filing.filing_date,
                    filing.is_amendment,
                ),
                reverse=True,
            )
        )
        company_name = document.payload.get("name")
        if not isinstance(company_name, str) or not company_name.strip():
            raise SecDataError("SEC submissions response is missing company name")
        sic_value = document.payload.get("sic")
        sic_code: int | None = None
        if sic_value not in (None, ""):
            try:
                sic_code = int(str(sic_value))
            except ValueError as exc:
                raise SecDataError("SEC submissions SIC must be numeric") from exc
            if not 100 <= sic_code <= 9999:
                raise SecDataError("SEC submissions SIC must contain 3 or 4 digits")
        sic_description = document.payload.get("sicDescription", "")
        if not isinstance(sic_description, str):
            raise SecDataError("SEC submissions sicDescription must be a string")
        return CompanySubmissionProfile(
            cik=normalized_cik,
            company_name=company_name.strip(),
            sic_code=sic_code,
            sic_description=sic_description.strip(),
            fiscal_year_end=fiscal_year_end or None,
            filings=sorted_filings,
        )

    def get_latest_10k_for_cik(self, cik: str | int) -> FilingDocument:
        filings = self.get_10k_filings(cik)
        if not filings:
            raise SecDataError(f"no 10-K filing found for CIK {self._normalize_cik(cik)}")
        metadata = filings[0]
        body, content_type, retrieved_at = self._get_bytes(metadata.filing_url)
        return FilingDocument(
            metadata=metadata,
            content=body.decode("utf-8", errors="replace"),
            content_type=content_type,
            retrieved_at=retrieved_at,
        )

    def get_latest_10k(
        self, ticker: str
    ) -> tuple[TickerResolution, FilingDocument]:
        resolution = self.resolve_ticker(ticker)
        return resolution, self.get_latest_10k_for_cik(resolution.cik)

    def _get_json(self, url: str) -> SecJsonDocument:
        cached = self._cache.get(f"json:{url}")
        if isinstance(cached, SecJsonDocument):
            return cached
        body, _, retrieved_at = self._request(url)
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SecDataError(f"SEC returned invalid JSON for {url}") from exc
        if not isinstance(payload, Mapping):
            raise SecDataError(f"SEC returned a non-object JSON payload for {url}")
        document = SecJsonDocument(
            source_url=url,
            retrieved_at=retrieved_at,
            payload=payload,
        )
        self._cache.set(f"json:{url}", document)
        return document

    def _get_bytes(self, url: str) -> tuple[bytes, str, datetime]:
        cache_key = f"bytes:{url}"
        cached = self._cache.get(cache_key)
        if isinstance(cached, tuple):
            return cached
        body, response, retrieved_at = self._request(url)
        result = (
            body,
            self._header_value(
                response.headers, "Content-Type", "application/octet-stream"
            ),
            retrieved_at,
        )
        self._cache.set(cache_key, result)
        return result

    def _request(self, url: str) -> tuple[bytes, HttpResponse, datetime]:
        attempts = self.config.max_retries + 1
        for attempt_index in range(attempts):
            self._pace_request()
            try:
                response = self._transport.get(
                    url,
                    headers={
                        "User-Agent": self.config.user_agent.strip(),
                        "Accept": "application/json, text/html;q=0.9",
                    },
                    timeout_seconds=self.config.timeout_seconds,
                    max_response_bytes=self.config.max_response_bytes,
                )
            except ResponseTooLarge as exc:
                raise SecRequestError(
                    url=url,
                    message=str(exc),
                    attempts=attempt_index + 1,
                    retryable=False,
                ) from exc
            except TransportFailure as exc:
                if attempt_index < self.config.max_retries:
                    self._sleep_before_retry(attempt_index)
                    continue
                raise SecRequestError(
                    url=url,
                    message="SEC request failed before receiving a response",
                    attempts=attempt_index + 1,
                    retryable=True,
                ) from exc

            if 200 <= response.status_code < 300:
                return response.body, response, self._wall_clock()
            retryable = response.status_code in RETRYABLE_STATUS_CODES
            if retryable and attempt_index < self.config.max_retries:
                self._sleep_before_retry(attempt_index)
                continue
            raise SecRequestError(
                url=url,
                message=f"SEC returned HTTP {response.status_code}",
                attempts=attempt_index + 1,
                status_code=response.status_code,
                retryable=retryable,
            )
        raise AssertionError("bounded SEC retry loop exited unexpectedly")

    def _pace_request(self) -> None:
        with self._pacing_lock:
            now = self._monotonic_clock()
            if self._last_request_at is not None:
                remaining = (
                    self.config.min_request_interval_seconds
                    - (now - self._last_request_at)
                )
                if remaining > 0.0:
                    self._sleeper(remaining)
            self._last_request_at = self._monotonic_clock()

    def _sleep_before_retry(self, attempt_index: int) -> None:
        delay = self.config.retry_backoff_seconds * (2**attempt_index)
        if delay > 0.0:
            self._sleeper(delay)

    @staticmethod
    def _normalize_cik(cik: object) -> str:
        if isinstance(cik, bool):
            raise SecDataError("CIK must be numeric")
        text = str(cik).strip()
        if not text.isdigit() or len(text) > 10:
            raise SecDataError("CIK must contain at most 10 digits")
        return text.zfill(10)

    @staticmethod
    def _string_list(mapping: Mapping[str, Any], key: str) -> list[str]:
        value = mapping.get(key)
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise SecDataError(f"SEC submissions field {key} must be a string array")
        return value

    @staticmethod
    def _validate_accession(accession: str) -> None:
        if not ACCESSION_PATTERN.fullmatch(accession):
            raise SecDataError(f"invalid SEC accession number: {accession}")

    @staticmethod
    def _validate_iso_date(value: str, field: str) -> None:
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise SecDataError(f"SEC submissions {field} must be an ISO date") from exc

    @staticmethod
    def _validate_primary_document(primary_document: str) -> None:
        path = PurePosixPath(primary_document)
        if (
            not primary_document
            or path.name != primary_document
            or primary_document in {".", ".."}
            or not PRIMARY_DOCUMENT_PATTERN.fullmatch(primary_document)
        ):
            raise SecDataError("invalid SEC primary document path")

    @staticmethod
    def _filing_url(cik: str, accession: str, primary_document: str) -> str:
        cik_without_leading_zeroes = str(int(cik))
        accession_without_dashes = accession.replace("-", "")
        return (
            f"{ARCHIVES_BASE_URL}/{cik_without_leading_zeroes}/"
            f"{accession_without_dashes}/{primary_document}"
        )

    @staticmethod
    def _header_value(
        headers: Mapping[str, str],
        name: str,
        default: str,
    ) -> str:
        expected = name.lower()
        for key, value in headers.items():
            if key.lower() == expected:
                return value
        return default
