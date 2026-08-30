from __future__ import annotations

from typing import Any

UNSET = object()


def chart_payload(
    *,
    symbol: str = "AAPL",
    price: Any = 178.2,
    currency: Any = "USD",
    market_time: Any = 1_788_036_000,
    exchange_name: Any = "NasdaqGS",
) -> dict[str, Any]:
    """A Yahoo chart response, shaped like the real one.

    Pass ``UNSET`` for any field to leave the key out of ``meta`` entirely,
    which is how the provider sees a genuinely absent value.
    """
    meta: dict[str, Any] = {}
    if symbol is not UNSET:
        meta["symbol"] = symbol
    if price is not UNSET:
        meta["regularMarketPrice"] = price
    if currency is not UNSET:
        meta["currency"] = currency
    if market_time is not UNSET:
        meta["regularMarketTime"] = market_time
    if exchange_name is not UNSET:
        meta["fullExchangeName"] = exchange_name
    return {
        "chart": {
            "result": [
                {
                    "meta": meta,
                    "timestamp": [1_788_036_000],
                    "indicators": {"quote": [{"close": [178.2]}]},
                }
            ],
            "error": None,
        }
    }


def chart_error_payload(
    *,
    code: str = "Not Found",
    description: str = "No data found, symbol may be delisted",
) -> dict[str, Any]:
    return {
        "chart": {
            "result": None,
            "error": {"code": code, "description": description},
        }
    }
