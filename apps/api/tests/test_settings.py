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
    assert settings.market_quote_enabled is True
    assert settings.market_quote_timeout_seconds == 5
    assert settings.market_quote_max_retries == 1
    assert settings.market_quote_ttl_seconds == 60
    assert settings.market_quote_failure_ttl_seconds == 30
    assert settings.market_quote_cache_max_entries == 128
    # Unset means the provider keeps its own verified browser identity.
    assert settings.market_quote_user_agent is None


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


@pytest.mark.parametrize("spelling", ["1", "true", "TRUE", "yes", "On", " true "])
def test_market_quote_enabled_accepts_every_true_spelling(spelling: str) -> None:
    settings = Settings.from_env({"MARKET_QUOTE_ENABLED": spelling})

    assert settings.market_quote_enabled is True


@pytest.mark.parametrize("spelling", ["0", "false", "FALSE", "no", "Off", " off "])
def test_market_quote_enabled_accepts_every_false_spelling(spelling: str) -> None:
    settings = Settings.from_env({"MARKET_QUOTE_ENABLED": spelling})

    assert settings.market_quote_enabled is False


@pytest.mark.parametrize("spelling", ["maybe", "2", "y", "enabled", "-1"])
def test_market_quote_enabled_rejects_anything_else(spelling: str) -> None:
    with pytest.raises(RuntimeError, match="MARKET_QUOTE_ENABLED must be one of"):
        Settings.from_env({"MARKET_QUOTE_ENABLED": spelling})


def test_market_quote_settings_are_read_from_the_environment() -> None:
    settings = Settings.from_env(
        {
            "MARKET_QUOTE_ENABLED": "off",
            "MARKET_QUOTE_TIMEOUT_SECONDS": "12",
            "MARKET_QUOTE_MAX_RETRIES": "0",
            "MARKET_QUOTE_TTL_SECONDS": "300",
            "MARKET_QUOTE_FAILURE_TTL_SECONDS": "45",
            "MARKET_QUOTE_CACHE_MAX_ENTRIES": "512",
            "MARKET_QUOTE_USER_AGENT": "DCFLens/9.9 (+https://example.com)",
        }
    )

    assert settings.market_quote_enabled is False
    assert settings.market_quote_timeout_seconds == 12
    assert settings.market_quote_max_retries == 0
    assert settings.market_quote_ttl_seconds == 300
    assert settings.market_quote_failure_ttl_seconds == 45
    assert settings.market_quote_cache_max_entries == 512
    assert settings.market_quote_user_agent == "DCFLens/9.9 (+https://example.com)"


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("MARKET_QUOTE_TIMEOUT_SECONDS", "0", "greater than zero"),
        ("MARKET_QUOTE_TIMEOUT_SECONDS", "31", "must be between 1 and 30"),
        ("MARKET_QUOTE_MAX_RETRIES", "4", "must be between 0 and 3"),
        ("MARKET_QUOTE_MAX_RETRIES", "-1", "must be between 0 and 3"),
        ("MARKET_QUOTE_TTL_SECONDS", "4", "must be between 5 and 900"),
        ("MARKET_QUOTE_TTL_SECONDS", "901", "must be between 5 and 900"),
        ("MARKET_QUOTE_FAILURE_TTL_SECONDS", "4", "must be between 5 and 600"),
        ("MARKET_QUOTE_FAILURE_TTL_SECONDS", "601", "must be between 5 and 600"),
        ("MARKET_QUOTE_CACHE_MAX_ENTRIES", "1025", "must be between 1 and 1024"),
        ("MARKET_QUOTE_TIMEOUT_SECONDS", "five", "must be an integer"),
    ],
)
def test_market_quote_numeric_bounds_are_enforced(
    name: str, value: str, message: str
) -> None:
    with pytest.raises(RuntimeError, match=message):
        Settings.from_env({name: value})


def test_market_quote_user_agent_rejects_header_injection() -> None:
    with pytest.raises(RuntimeError, match="printable ASCII"):
        Settings.from_env(
            {"MARKET_QUOTE_USER_AGENT": "DCFLens/0.2\r\nX-Injected: yes"}
        )


def test_market_quote_user_agent_rejects_other_control_and_wide_characters() -> None:
    for hostile in ("DCFLens\x00probe", "DCFLens\tprobe", "DCFLens\u2014probe"):
        with pytest.raises(RuntimeError, match="printable ASCII"):
            Settings.from_env({"MARKET_QUOTE_USER_AGENT": hostile})


def test_market_quote_user_agent_is_length_bounded() -> None:
    with pytest.raises(RuntimeError, match="at most 256 characters"):
        Settings.from_env({"MARKET_QUOTE_USER_AGENT": "D" * 257})

    settings = Settings.from_env({"MARKET_QUOTE_USER_AGENT": "D" * 256})

    assert len(settings.market_quote_user_agent) == 256
