from __future__ import annotations

from typing import Any


def ticker_mapping() -> dict[str, Any]:
    return {
        "0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        "1": {"cik_str": 1067983, "ticker": "BRK-B", "title": "Berkshire Hathaway"},
    }


def submissions_payload() -> dict[str, Any]:
    return {
        "cik": "0000320193",
        "name": "Apple Inc.",
        "sic": "3571",
        "sicDescription": "Electronic Computers",
        "fiscalYearEnd": "0928",
        "filings": {
            "recent": {
                "accessionNumber": [
                    "0000320193-25-000003",
                    "0000320193-25-000002",
                    "0000320193-25-000001",
                    "0000320193-24-000001",
                ],
                "filingDate": [
                    "2025-03-01",
                    "2025-02-20",
                    "2025-02-01",
                    "2024-02-01",
                ],
                "reportDate": [
                    "2024-12-31",
                    "2024-12-31",
                    "2024-12-31",
                    "2023-12-31",
                ],
                "form": ["10-K/A", "8-K", "10-K", "10-K"],
                "primaryDocument": [
                    "aapl-20241231x10ka.htm",
                    "aapl-8k.htm",
                    "aapl-20241231x10k.htm",
                    "aapl-20231231x10k.htm",
                ],
            }
        },
    }
