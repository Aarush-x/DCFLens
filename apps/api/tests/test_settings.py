import pytest

from app.core.settings import Settings


def test_development_defaults_are_safe() -> None:
    settings = Settings.from_env({})

    assert settings.app_env == "development"
    assert settings.cache_ttl_seconds == 900
    assert settings.cors_allowed_origins == (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )
    assert settings.google_api_key is None
    assert settings.gemini_model == "gemini-2.5-flash"
    assert settings.gemini_timeout_seconds == 30
    assert settings.port == 8000
    assert settings.cache_max_entries == 128
    assert settings.sec_timeout_seconds == 15
    assert settings.sec_max_retries == 2
    assert settings.cors_allowed_origin_regex is None


def test_unknown_application_environment_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="APP_ENV must be one of"):
        Settings.from_env({"APP_ENV": "prodution"})


def test_cors_entries_must_be_origins() -> None:
    with pytest.raises(RuntimeError, match="must not contain paths"):
        Settings.from_env(
            {"CORS_ALLOWED_ORIGINS": "https://dcflens.example.com/api"}
        )


def test_production_requires_exact_cors_and_sec_identity() -> None:
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        Settings.from_env({"APP_ENV": "production"})

    with pytest.raises(RuntimeError, match="Wildcard CORS"):
        Settings.from_env(
            {
                "APP_ENV": "production",
                "CORS_ALLOWED_ORIGINS": "*",
                "SEC_IDENTITY": "DCFLens owner@example.com",
            }
        )

    with pytest.raises(RuntimeError, match="SEC_IDENTITY"):
        Settings.from_env(
            {
                "APP_ENV": "production",
                "CORS_ALLOWED_ORIGINS": "https://dcflens.example.com",
            }
        )


def test_production_configuration_is_normalized() -> None:
    settings = Settings.from_env(
        {
            "APP_ENV": "production",
            "LOG_LEVEL": "warning",
            "CACHE_TTL_SECONDS": "1200",
            "GOOGLE_API_KEY": " example-placeholder ",
            "GEMINI_MODEL": "gemini-2.5-flash",
            "GEMINI_TIMEOUT_SECONDS": "45",
            "SEC_IDENTITY": "DCFLens owner@example.com",
            "CORS_ALLOWED_ORIGINS": (
                "https://dcflens.example.com/, https://preview.example.com"
            ),
            "CORS_VERCEL_PREVIEW_PROJECT": "dcflens",
            "CORS_VERCEL_PREVIEW_TEAM": "aarush-x",
            "PORT": "10000",
            "SEC_MAX_RETRIES": "0",
        }
    )

    assert settings.log_level == "WARNING"
    assert settings.cache_ttl_seconds == 1200
    assert settings.gemini_model == "gemini-2.5-flash"
    assert settings.gemini_timeout_seconds == 45
    assert settings.cors_allowed_origins == (
        "https://dcflens.example.com",
        "https://preview.example.com",
    )
    assert settings.cors_allowed_origin_regex == (
        r"^https://dcflens(?:-[a-z0-9-]+)?-aarush\-x\.vercel\.app$"
    )
    assert settings.port == 10000
    assert settings.sec_max_retries == 0


def test_preview_cors_requires_a_narrow_project_and_team_pair() -> None:
    with pytest.raises(RuntimeError, match="must be set together"):
        Settings.from_env(
            {
                "CORS_VERCEL_PREVIEW_PROJECT": "dcflens",
            }
        )

    with pytest.raises(RuntimeError, match="lowercase Vercel slug"):
        Settings.from_env(
            {
                "CORS_VERCEL_PREVIEW_PROJECT": ".*",
                "CORS_VERCEL_PREVIEW_TEAM": "aarush-x",
            }
        )


def test_port_is_bounded() -> None:
    with pytest.raises(RuntimeError, match="PORT must be between"):
        Settings.from_env({"PORT": "70000"})
