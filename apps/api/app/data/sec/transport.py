"""Backwards-compatible aliases for the shared bounded HTTP transport.

The transport was never SEC-specific; it now lives in ``app.data.transport`` so
the market-quote adapter can reuse it. These names are kept so existing SEC
imports and tests keep working unchanged.
"""
from __future__ import annotations

from app.data.transport import (
    HttpResponse,
    HttpTransport,
    ResponseTooLarge,
    TransportFailure,
    UrllibHttpTransport,
)

SecTransport = HttpTransport
UrllibSecTransport = UrllibHttpTransport

__all__ = [
    "HttpResponse",
    "HttpTransport",
    "ResponseTooLarge",
    "SecTransport",
    "TransportFailure",
    "UrllibHttpTransport",
    "UrllibSecTransport",
]
