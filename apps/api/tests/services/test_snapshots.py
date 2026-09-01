from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

from pydantic import TypeAdapter

from app.services.analysis import AnalysisCore
from app.services.snapshots import PostgresSnapshotStore, _next_refresh


class _Result:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class _Connection:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.calls.append((" ".join(query.split()), params))
        if "SELECT payload" in query:
            return _Result(self.rows.get(params[0]))
        return _Result()


def test_next_refresh_is_the_next_configured_utc_boundary() -> None:
    before = datetime(2026, 9, 1, 22, 59, tzinfo=timezone.utc)
    after = datetime(2026, 9, 1, 23, 1, tzinfo=timezone.utc)

    assert _next_refresh(before, 23) == datetime(
        2026, 9, 1, 23, tzinfo=timezone.utc
    )
    assert _next_refresh(after, 23) == datetime(
        2026, 9, 2, 23, tzinfo=timezone.utc
    )


def test_postgres_store_round_trips_json_without_logging_payloads() -> None:
    created = datetime(2026, 9, 1, 20, tzinfo=timezone.utc)
    refresh = datetime(2026, 9, 1, 23, tzinfo=timezone.utc)
    rows = {"analysis:v1:AAPL": ({"value": 7}, "acc-1", created, refresh)}
    connection = _Connection(rows)
    connect_calls = []

    def connect(url, **kwargs):
        connect_calls.append((url, kwargs))
        return connection

    store = PostgresSnapshotStore(
        database_url="postgresql://user:secret@example.test/dcflens",
        encoder=lambda value: {"value": value},
        decoder=lambda payload: payload["value"],
        refresh_hour_utc=23,
        connect_timeout_seconds=4,
        connect=connect,
        clock=lambda: created,
    )

    snapshot = store.get("analysis:v1:AAPL")
    store.set(
        "analysis:v1:AAPL",
        8,
        ticker="AAPL",
        source_accession="acc-2",
    )
    store.touch("analysis:v1:AAPL")

    assert snapshot is not None
    assert snapshot.value == 7
    assert snapshot.source_accession == "acc-1"
    assert connect_calls
    assert all(call[1]["autocommit"] is True for call in connect_calls)
    assert any("ON CONFLICT" in query for query, _params in connection.calls)
    assert any("SET refresh_after" in query for query, _params in connection.calls)


def test_complete_analysis_core_has_a_safe_json_round_trip() -> None:
    fixture = Path(__file__).resolve().parents[4] / "web/src/mocks/msft-live.json"
    envelope = json.loads(fixture.read_text())
    payload = {
        key: envelope[key]
        for key in (
            "ticker",
            "cik",
            "company_name",
            "sec_retrieved_at",
            "latest_filing",
            "missing_metrics",
            "normalization_warnings",
            "analysis",
        )
    }
    adapter = TypeAdapter(AnalysisCore)

    restored = adapter.validate_python(
        adapter.dump_python(adapter.validate_python(payload), mode="json")
    )

    assert restored.ticker == "MSFT"
    assert restored.analysis.status.value in {"APPLIED", "DETERMINISTIC_FALLBACK"}
    assert len(restored.analysis.deterministic_checklist.results) == 10
