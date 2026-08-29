from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Generic, Protocol, TypeVar

from app.data.sec.cache import BoundedTtlCache


Key = TypeVar("Key")
Value = TypeVar("Value")


class CacheBackend(Protocol[Key, Value]):
    """Replaceable cache boundary; the valuation domain does not depend on it."""

    def get(self, key: Key) -> Value | None: ...

    def set(self, key: Key, value: Value) -> None: ...


class MemoryCache(BoundedTtlCache[Key, Value]):
    """Process-local prototype cache; replaceable by a shared implementation."""


@dataclass(slots=True)
class _Flight(Generic[Value]):
    event: threading.Event = field(default_factory=threading.Event)
    result: Value | None = None
    error: BaseException | None = None


class SingleFlight(Generic[Key, Value]):
    """Coalesce concurrent work for an identical key within one API process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._flights: dict[Key, _Flight[Value]] = {}

    def run(self, key: Key, operation: Callable[[], Value]) -> Value:
        with self._lock:
            flight = self._flights.get(key)
            leader = flight is None
            if flight is None:
                flight = _Flight()
                self._flights[key] = flight

        if leader:
            try:
                flight.result = operation()
            except BaseException as exc:
                flight.error = exc
            finally:
                flight.event.set()
                with self._lock:
                    self._flights.pop(key, None)
        else:
            flight.event.wait()

        if flight.error is not None:
            raise flight.error
        return flight.result  # type: ignore[return-value]
