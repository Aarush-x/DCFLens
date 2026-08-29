from __future__ import annotations

import math

import pytest

from app.data.sec.cache import BoundedTtlCache


@pytest.mark.parametrize("max_entries", [0, -1, True])
def test_cache_rejects_invalid_entry_bounds(max_entries: int) -> None:
    with pytest.raises(ValueError, match="max_entries"):
        BoundedTtlCache[str, str](max_entries=max_entries, ttl_seconds=1.0)


@pytest.mark.parametrize("ttl_seconds", [0.0, -1.0, math.inf, math.nan, True])
def test_cache_rejects_invalid_ttl_bounds(ttl_seconds: float) -> None:
    with pytest.raises(ValueError, match="ttl_seconds"):
        BoundedTtlCache[str, str](max_entries=1, ttl_seconds=ttl_seconds)
