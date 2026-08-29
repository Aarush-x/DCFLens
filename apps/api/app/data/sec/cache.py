from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Generic, TypeVar


Key = TypeVar("Key")
Value = TypeVar("Value")


@dataclass(frozen=True, slots=True)
class _CacheEntry(Generic[Value]):
    value: Value
    expires_at: float


class BoundedTtlCache(Generic[Key, Value]):
    """Instance-local, thread-safe TTL cache with least-recently-used eviction."""

    def __init__(
        self,
        *,
        max_entries: int,
        ttl_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if (
            isinstance(max_entries, bool)
            or not isinstance(max_entries, int)
            or max_entries <= 0
        ):
            raise ValueError("max_entries must be greater than zero")
        if (
            isinstance(ttl_seconds, bool)
            or not isinstance(ttl_seconds, (int, float))
            or not math.isfinite(float(ttl_seconds))
            or ttl_seconds <= 0.0
        ):
            raise ValueError("ttl_seconds must be greater than zero")
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries: OrderedDict[Key, _CacheEntry[Value]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Key) -> Value | None:
        now = self._clock()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return entry.value

    def set(self, key: Key, value: Value) -> None:
        entry = _CacheEntry(value=value, expires_at=self._clock() + self._ttl_seconds)
        with self._lock:
            self._entries[key] = entry
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)
