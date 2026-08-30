from __future__ import annotations

import urllib.error
import urllib.request
from http.client import HTTPException
from dataclasses import dataclass
from typing import Mapping, Protocol


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status_code: int
    headers: Mapping[str, str]
    body: bytes


class TransportFailure(Exception):
    """Network or local transport failure before an HTTP response is available."""


class ResponseTooLarge(TransportFailure):
    """Response exceeded the configured byte limit."""


class SecTransport(Protocol):
    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout_seconds: float,
        max_response_bytes: int,
    ) -> HttpResponse: ...


class UrllibSecTransport:
    """Small production transport using only Python's standard library."""

    def get(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        timeout_seconds: float,
        max_response_bytes: int,
    ) -> HttpResponse:
        request = urllib.request.Request(url=url, headers=dict(headers), method="GET")
        try:
            try:
                with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                    response_headers = dict(response.headers.items())
                    body = self._bounded_read(response, response_headers, max_response_bytes)
                    return HttpResponse(response.status, response_headers, body)
            except urllib.error.HTTPError as exc:
                try:
                    response_headers = dict(exc.headers.items()) if exc.headers else {}
                    body = self._bounded_read(exc, response_headers, max_response_bytes)
                    return HttpResponse(exc.code, response_headers, body)
                finally:
                    exc.close()
        except (OSError, HTTPException) as exc:
            # Includes reset/truncated response bodies and errors while reading
            # an HTTP error response, not just failures opening the connection.
            raise TransportFailure("SEC transport failed") from exc

    @staticmethod
    def _bounded_read(
        response: object,
        headers: Mapping[str, str],
        max_response_bytes: int,
    ) -> bytes:
        content_length = headers.get("Content-Length") or headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > max_response_bytes:
                    raise ResponseTooLarge("SEC response exceeds configured byte limit")
            except ValueError:
                pass
        reader = getattr(response, "read")
        body = reader(max_response_bytes + 1)
        if len(body) > max_response_bytes:
            raise ResponseTooLarge("SEC response exceeds configured byte limit")
        return body
