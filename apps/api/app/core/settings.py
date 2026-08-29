from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import urlsplit

from dotenv import load_dotenv


LOCAL_CORS_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
VALID_APP_ENVIRONMENTS = {"development", "test", "production"}
VALID_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
VERCEL_SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

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


def _normalize_origin(raw_origin: str) -> str:
    origin = raw_origin.strip().rstrip("/")
    if origin == "*":
        return origin

    parsed = urlsplit(origin)
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
        if app_env == "production" and (
            not sec_identity or "@" not in sec_identity
        ):
            raise RuntimeError(
                "SEC_IDENTITY must include an application name and monitored email"
            )

        return cls(
            app_env=app_env,
            log_level=log_level,
            cache_ttl_seconds=_positive_int(
                "CACHE_TTL_SECONDS", 900, environment
            ),
            google_api_key=_clean(environment.get("GOOGLE_API_KEY")) or None,
            gemini_model=_clean(environment.get("GEMINI_MODEL") or "gemini-2.5-flash"),
            gemini_timeout_seconds=_positive_int(
                "GEMINI_TIMEOUT_SECONDS", 30, environment
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
        )


settings = Settings.from_env()
