from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.services.cache import MemoryCache, SingleFlight


def test_memory_cache_is_bounded_and_expires() -> None:
    now = [0.0]
    cache: MemoryCache[str, int] = MemoryCache(
        max_entries=1,
        ttl_seconds=10,
        clock=lambda: now[0],
    )
    cache.set("first", 1)
    cache.set("second", 2)

    assert cache.get("first") is None
    assert cache.get("second") == 2

    now[0] = 10.0
    assert cache.get("second") is None


def test_singleflight_suppresses_duplicate_concurrent_work() -> None:
    singleflight: SingleFlight[str, object] = SingleFlight()
    entered = threading.Event()
    release = threading.Event()
    call_count = 0
    result = object()

    def operation() -> object:
        nonlocal call_count
        call_count += 1
        entered.set()
        release.wait(timeout=2)
        return result

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(singleflight.run, "AAPL", operation) for _ in range(8)]
        assert entered.wait(timeout=1)
        time.sleep(0.05)
        release.set()
        values = [future.result(timeout=1) for future in futures]

    assert call_count == 1
    assert all(value is result for value in values)


def test_singleflight_does_not_cache_failures() -> None:
    singleflight: SingleFlight[str, object] = SingleFlight()

    def failure() -> object:
        raise RuntimeError("transient")

    for _ in range(2):
        try:
            singleflight.run("AAPL", failure)
        except RuntimeError as exc:
            assert str(exc) == "transient"
        else:
            raise AssertionError("failure should be propagated")
