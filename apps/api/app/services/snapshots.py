from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Generic, Protocol, TypeVar


logger = logging.getLogger(__name__)

Value = TypeVar("Value")


@dataclass(frozen=True, slots=True)
class StoredSnapshot(Generic[Value]):
    """A durable analysis value plus the metadata used to revalidate it."""

    value: Value
    source_accession: str | None
    created_at: datetime
    refresh_after: datetime

    @property
    def is_stale(self) -> bool:
        return self.refresh_after <= datetime.now(timezone.utc)


class SnapshotStore(Protocol[Value]):
    """Durable storage boundary kept outside the valuation and AI domains."""

    def get(self, key: str) -> StoredSnapshot[Value] | None: ...

    def set(
        self,
        key: str,
        value: Value,
        *,
        ticker: str,
        source_accession: str | None,
    ) -> None: ...

    def touch(self, key: str) -> None: ...


class NullSnapshotStore(Generic[Value]):
    """Zero-configuration fallback used when DATABASE_URL is not configured."""

    def get(self, key: str) -> StoredSnapshot[Value] | None:
        return None

    def set(
        self,
        key: str,
        value: Value,
        *,
        ticker: str,
        source_accession: str | None,
    ) -> None:
        return None

    def touch(self, key: str) -> None:
        return None


class PostgresSnapshotStore(Generic[Value]):
    """Small JSONB snapshot store compatible with Render, Neon, or any Postgres.

    Connections are intentionally short-lived. That works with serverless Postgres
    compute that scales to zero, avoids retaining dead connections across Render
    sleep cycles, and keeps the web process's memory footprint bounded.

    Database failures degrade to a cache miss. They are logged by exception type
    only, so connection strings, credentials, and payloads never reach logs.
    """

    _SCHEMA = """
        CREATE TABLE IF NOT EXISTS dcflens_analysis_snapshots (
            cache_key TEXT PRIMARY KEY,
            ticker VARCHAR(10) NOT NULL,
            source_accession TEXT,
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            refresh_after TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    """

    def __init__(
        self,
        *,
        database_url: str,
        encoder: Callable[[Value], dict[str, Any]],
        decoder: Callable[[dict[str, Any]], Value],
        refresh_hour_utc: int,
        connect_timeout_seconds: int,
        connect: Callable[..., Any] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not database_url.strip():
            raise ValueError("database_url is required")
        if not 0 <= refresh_hour_utc <= 23:
            raise ValueError("refresh_hour_utc must be between 0 and 23")
        self._database_url = database_url
        self._encoder = encoder
        self._decoder = decoder
        self._refresh_hour_utc = refresh_hour_utc
        self._connect_timeout_seconds = connect_timeout_seconds
        self._connect_override = connect
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._schema_lock = threading.Lock()
        self._schema_ready = False

    def get(self, key: str) -> StoredSnapshot[Value] | None:
        try:
            self._ensure_schema()
            with self._connection() as connection:
                row = connection.execute(
                    """
                    SELECT payload, source_accession, created_at, refresh_after
                    FROM dcflens_analysis_snapshots
                    WHERE cache_key = %s
                    """,
                    (key,),
                ).fetchone()
            if row is None:
                return None
            payload, accession, created_at, refresh_after = row
            return StoredSnapshot(
                value=self._decoder(payload),
                source_accession=accession,
                created_at=_as_utc(created_at),
                refresh_after=_as_utc(refresh_after),
            )
        except Exception as exc:
            logger.warning(
                "analysis_snapshot_read_failed",
                extra={"error_type": type(exc).__name__},
            )
            return None

    def set(
        self,
        key: str,
        value: Value,
        *,
        ticker: str,
        source_accession: str | None,
    ) -> None:
        try:
            self._ensure_schema()
            now = _as_utc(self._clock())
            refresh_after = _next_refresh(now, self._refresh_hour_utc)
            payload = self._encoder(value)
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO dcflens_analysis_snapshots (
                        cache_key, ticker, source_accession, payload,
                        created_at, refresh_after, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (cache_key) DO UPDATE SET
                        ticker = EXCLUDED.ticker,
                        source_accession = EXCLUDED.source_accession,
                        payload = EXCLUDED.payload,
                        created_at = EXCLUDED.created_at,
                        refresh_after = EXCLUDED.refresh_after,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        key,
                        ticker,
                        source_accession,
                        self._jsonb(payload),
                        now,
                        refresh_after,
                        now,
                    ),
                )
        except Exception as exc:
            logger.warning(
                "analysis_snapshot_write_failed",
                extra={"ticker": ticker, "error_type": type(exc).__name__},
            )

    def touch(self, key: str) -> None:
        """Record a successful filing check without regenerating the analysis."""
        try:
            self._ensure_schema()
            now = _as_utc(self._clock())
            with self._connection() as connection:
                connection.execute(
                    """
                    UPDATE dcflens_analysis_snapshots
                    SET refresh_after = %s, updated_at = %s
                    WHERE cache_key = %s
                    """,
                    (_next_refresh(now, self._refresh_hour_utc), now, key),
                )
        except Exception as exc:
            logger.warning(
                "analysis_snapshot_touch_failed",
                extra={"error_type": type(exc).__name__},
            )

    def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        with self._schema_lock:
            if self._schema_ready:
                return
            with self._connection() as connection:
                connection.execute(self._SCHEMA)
            self._schema_ready = True

    def _connection(self) -> Any:
        if self._connect_override is not None:
            return self._connect_override(
                self._database_url,
                connect_timeout=self._connect_timeout_seconds,
                autocommit=True,
            )
        import psycopg

        return psycopg.connect(
            self._database_url,
            connect_timeout=self._connect_timeout_seconds,
            autocommit=True,
        )

    @staticmethod
    def _jsonb(payload: dict[str, Any]) -> Any:
        try:
            from psycopg.types.json import Jsonb
        except ImportError:
            # Test doubles accept the plain mapping. Production installs psycopg.
            return payload
        return Jsonb(payload)


def _next_refresh(now: datetime, refresh_hour_utc: int) -> datetime:
    candidate = now.replace(
        hour=refresh_hour_utc,
        minute=0,
        second=0,
        microsecond=0,
    )
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
