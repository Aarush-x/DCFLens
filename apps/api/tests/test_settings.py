import pytest

from app.core.settings import Settings


def test_development_defaults_are_safe() -> None:
    settings = Settings.from_env({})

    assert settings.app_env == "development"
    assert settings.cache_ttl_seconds == 900
    assert settings.cors_allowed_origins == ("http://localhost:3000",)
    assert settings.google_api_key is None


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
            "SEC_IDENTITY": "DCFLens owner@example.com",
            "CORS_ALLOWED_ORIGINS": (
                "https://dcflens.example.com/, https://preview.example.com"
            ),
        }
    )

    assert settings.log_level == "WARNING"
    assert settings.cache_ttl_seconds == 1200
    assert settings.cors_allowed_origins == (
        "https://dcflens.example.com",
        "https://preview.example.com",
    )
