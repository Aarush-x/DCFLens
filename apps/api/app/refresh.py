from __future__ import annotations

import json
import os

from app.core.settings import settings
from app.services.analysis import build_analysis_service, normalize_ticker


def main() -> None:
    """Revalidate named snapshots without printing analysis or provider data."""
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is required for durable analysis refresh")
    tickers = tuple(
        dict.fromkeys(
            normalize_ticker(value)
            for value in os.getenv("REFRESH_TICKERS", "").split(",")
            if value.strip()
        )
    )
    if not tickers:
        raise SystemExit("REFRESH_TICKERS must contain at least one ticker")

    service = build_analysis_service(settings)
    completed: list[str] = []
    for ticker in tickers:
        service.refresh(ticker)
        completed.append(ticker)
    print(json.dumps({"status": "ok", "refreshed": completed}))


if __name__ == "__main__":
    main()
