from __future__ import annotations


class AnalysisServiceError(Exception):
    code = "analysis_error"


class InvalidTickerError(AnalysisServiceError, ValueError):
    code = "invalid_ticker"


class UnsupportedTickerError(AnalysisServiceError):
    code = "unsupported_ticker"


class MissingSecDataError(AnalysisServiceError):
    code = "missing_sec_data"


class ProviderRateLimitError(AnalysisServiceError):
    code = "provider_rate_limit"


class SecProviderError(AnalysisServiceError):
    code = "sec_provider_unavailable"


class CalculationError(AnalysisServiceError):
    code = "calculation_error"
