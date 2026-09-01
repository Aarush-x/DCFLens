from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import refresh


def test_refresh_requires_durable_storage(monkeypatch) -> None:
    monkeypatch.setattr(refresh, "settings", SimpleNamespace(database_url=None))

    with pytest.raises(SystemExit, match="DATABASE_URL"):
        refresh.main()


def test_refresh_revalidates_each_unique_normalized_ticker(
    monkeypatch, capsys
) -> None:
    calls = []
    service = SimpleNamespace(refresh=lambda ticker: calls.append(ticker))
    monkeypatch.setattr(
        refresh,
        "settings",
        SimpleNamespace(database_url="postgresql://configured"),
    )
    monkeypatch.setattr(refresh, "build_analysis_service", lambda _settings: service)
    monkeypatch.setenv("REFRESH_TICKERS", " aapl,MSFT,AAPL ")

    refresh.main()

    assert calls == ["AAPL", "MSFT"]
    assert '"refreshed": ["AAPL", "MSFT"]' in capsys.readouterr().out
