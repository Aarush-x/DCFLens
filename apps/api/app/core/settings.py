from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlsplit

from dotenv import load_dotenv

from app.ai.gemini import MODEL_PATTERN
from app.data.sec.client import SecClientConfig
from app.data.sec.errors import SecConfigurationError


LOCAL_CORS_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
VALID_APP_ENVIRONMENTS = {"development", "test", "production"}
VALID_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
VERCEL_SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
TRUE_SPELLINGS = {"1", "true", "yes", "on"}
FALSE_SPELLINGS = {"0", "false", "no", "off"}
MAX_USER_AGENT_LENGTH = 256

load_dotenv()


def _clean(value: str | None) -> str:
    return (value or "").strip().strip("'\"")


def _positive_int(
    name: str,
    default: int,
    environment: Mapping[str, str],
) -> int:
    raw_value = _clean(environment.get(name))
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


def _bounded_int(
    name: str,
    default: int,
    environment: Mapping[str, str],
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = _positive_int(name, default, environment)
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _bounded_nonnegative_int(
    name: str,
    default: int,
    environment: Mapping[str, str],
    *,
    maximum: int,
) -> int:
    raw_value = _clean(environment.get(name))
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not 0 <= value <= maximum:
        raise RuntimeError(f"{name} must be between 0 and {maximum}")
    return value


def _boolean(
    name: str,
    default: bool,
    environment: Mapping[str, str],
) -> bool:
    raw_value = _clean(environment.get(name)).lower()
    if not raw_value:
        return default
    if raw_value in TRUE_SPELLINGS:
        return True
    if raw_value in FALSE_SPELLINGS:
        return False
    spellings = ", ".join(sorted(TRUE_SPELLINGS | FALSE_SPELLINGS))
    raise RuntimeError(f"{name} must be one of: {spellings}")


def _user_agent(
    name: str,
    environment: Mapping[str, str],
) -> str | None:
    """An operator override, or None to let the provider keep its own default.

    There is no default here on purpose. app/data/market/yahoo.py documents a
    verified fact -- Yahoo 429s an unidentified client outright -- so its browser
    identity is a working default this layer must not silently replace.
    """
    raw_value = _clean(environment.get(name))
    if not raw_value:
        return None
    # Deliberately regex-free: browser user-agent strings are unstructured, so
    # there is no shape to match against. The only real hazards are header
    # injection and unbounded length, and printable ASCII already excludes CR,
    # LF and every other control character.
    if len(raw_value) > MAX_USER_AGENT_LENGTH:
        raise RuntimeError(
            f"{name} must be at most {MAX_USER_AGENT_LENGTH} characters"
        )
    if not raw_value.isascii() or not raw_value.isprintable():
        raise RuntimeError(f"{name} must contain printable ASCII characters only")
    return raw_value


def _normalize_origin(raw_origin: str) -> str:
    origin = raw_origin.strip().rstrip("/")
    if origin == "*":
        return origin

    try:
        parsed = urlsplit(origin)
        port = parsed.port
    except ValueError as exc:
        raise RuntimeError("CORS_ALLOWED_ORIGINS contains an invalid origin or port") from exc
    if (
        not parsed.hostname or "*" in origin
        or any(character.isspace() for character in origin)
        or port == 0
    ):
        raise RuntimeError("CORS_ALLOWED_ORIGINS must contain explicit valid origins")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS entries must be absolute http or https origins"
        )
    if parsed.username or parsed.password:
        raise RuntimeError("CORS_ALLOWED_ORIGINS entries must not contain credentials")
    if parsed.path or parsed.query or parsed.fragment:
        raise RuntimeError(
            "CORS_ALLOWED_ORIGINS entries must not contain paths, queries, or fragments"
        )
    return origin


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: str
    log_level: str
    cache_ttl_seconds: int
    google_api_key: str | None
    gemini_model: str
    gemini_timeout_seconds: int
    sec_identity: str
    cors_allowed_origins: tuple[str, ...]
    cors_allowed_origin_regex: str | None
    port: int
    cache_max_entries: int
    sec_timeout_seconds: int
    sec_max_retries: int
    market_quote_enabled: bool
    market_quote_timeout_seconds: int
    market_quote_max_retries: int
    market_quote_ttl_seconds: int
    market_quote_failure_ttl_seconds: int
    market_quote_cache_max_entries: int
    market_quote_user_agent: str | None
    alphavantage_api_key: str | None

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> "Settings":
        environment = os.environ if values is None else values
        app_env = _clean(environment.get("APP_ENV") or "development").lower()
        if app_env not in VALID_APP_ENVIRONMENTS:
            choices = ", ".join(sorted(VALID_APP_ENVIRONMENTS))
            raise RuntimeError(f"APP_ENV must be one of: {choices}")
        log_level = _clean(environment.get("LOG_LEVEL") or "INFO").upper()
        if log_level not in VALID_LOG_LEVELS:
            choices = ", ".join(sorted(VALID_LOG_LEVELS))
            raise RuntimeError(f"LOG_LEVEL must be one of: {choices}")

        origins_value = _clean(environment.get("CORS_ALLOWED_ORIGINS"))
        if origins_value:
            origins = tuple(
                _normalize_origin(origin)
                for origin in origins_value.split(",")
                if origin.strip()
            )
        elif app_env == "production":
            origins = ()
        else:
            origins = LOCAL_CORS_ORIGINS

        if app_env == "production" and not origins:
            raise RuntimeError("CORS_ALLOWED_ORIGINS is required in production")
        if app_env == "production" and "*" in origins:
            raise RuntimeError("Wildcard CORS origins are not allowed in production")

        preview_project = _clean(environment.get("CORS_VERCEL_PREVIEW_PROJECT")).lower()
        preview_team = _clean(environment.get("CORS_VERCEL_PREVIEW_TEAM")).lower()
        if bool(preview_project) != bool(preview_team):
            raise RuntimeError(
                "CORS_VERCEL_PREVIEW_PROJECT and CORS_VERCEL_PREVIEW_TEAM must be set together"
            )
        for name, value in (
            ("CORS_VERCEL_PREVIEW_PROJECT", preview_project),
            ("CORS_VERCEL_PREVIEW_TEAM", preview_team),
        ):
            if value and not VERCEL_SLUG_PATTERN.fullmatch(value):
                raise RuntimeError(f"{name} must be a lowercase Vercel slug")
        preview_regex = None
        if preview_project and preview_team:
            preview_regex = (
                rf"^https://{re.escape(preview_project)}"
                rf"(?:-[a-z0-9-]+)?-{re.escape(preview_team)}\.vercel\.app$"
            )

        sec_identity = _clean(environment.get("SEC_IDENTITY"))
        if sec_identity or app_env == "production":
            try:
                SecClientConfig(user_agent=sec_identity)
            except SecConfigurationError as exc:
                raise RuntimeError(
                    "SEC_IDENTITY must include a valid application name and monitored email, without control characters"
                ) from exc
        gemini_model = _clean(environment.get("GEMINI_MODEL") or "gemini-3.5-flash")
        if not MODEL_PATTERN.fullmatch(gemini_model):
            raise RuntimeError("GEMINI_MODEL must be a safe gemini-* identifier")

        return cls(
            app_env=app_env,
            log_level=log_level,
            cache_ttl_seconds=_bounded_int(
                "CACHE_TTL_SECONDS", 900, environment, minimum=1, maximum=86_400
            ),
            google_api_key=_clean(environment.get("GOOGLE_API_KEY")) or None,
            gemini_model=gemini_model,
            gemini_timeout_seconds=_bounded_int(
                "GEMINI_TIMEOUT_SECONDS", 30, environment, minimum=1, maximum=120
            ),
            sec_identity=sec_identity,
            cors_allowed_origins=origins,
            cors_allowed_origin_regex=preview_regex,
            port=_bounded_int(
                "PORT", 8000, environment, minimum=1, maximum=65_535
            ),
            cache_max_entries=_bounded_int(
                "CACHE_MAX_ENTRIES", 128, environment, minimum=1, maximum=10_000
            ),
            sec_timeout_seconds=_bounded_int(
                "SEC_TIMEOUT_SECONDS", 15, environment, minimum=1, maximum=120
            ),
            sec_max_retries=_bounded_nonnegative_int(
                "SEC_MAX_RETRIES", 2, environment, maximum=5
            ),
            market_quote_enabled=_boolean(
                "MARKET_QUOTE_ENABLED", True, environment
            ),
            market_quote_timeout_seconds=_bounded_int(
                "MARKET_QUOTE_TIMEOUT_SECONDS", 5, environment, minimum=1, maximum=30
            ),
            market_quote_max_retries=_bounded_nonnegative_int(
                "MARKET_QUOTE_MAX_RETRIES", 1, environment, maximum=3
            ),
            market_quote_ttl_seconds=_bounded_int(
                "MARKET_QUOTE_TTL_SECONDS", 60, environment, minimum=5, maximum=900
            ),
            market_quote_failure_ttl_seconds=_bounded_int(
                "MARKET_QUOTE_FAILURE_TTL_SECONDS",
                30,
                environment,
                minimum=5,
                maximum=600,
            ),
            market_quote_cache_max_entries=_bounded_int(
                "MARKET_QUOTE_CACHE_MAX_ENTRIES",
                128,
                environment,
                minimum=1,
                maximum=1_024,
            ),
            market_quote_user_agent=_user_agent(
                "MARKET_QUOTE_USER_AGENT", environment
            ),
            # Presence of this key is what selects the quote provider: set it and
            # the price comes from Alpha Vantage, leave it unset and the Yahoo
            # client stands exactly as before. One variable rather than a provider
            # name plus a key, because a name without a key is a broken config
            # that only fails at the first request.
            alphavantage_api_key=_clean(environment.get("ALPHAVANTAGE_API_KEY")) or None,
        )


settings = Settings.from_env()
