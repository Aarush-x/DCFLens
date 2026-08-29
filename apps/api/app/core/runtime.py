from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class ServerConfig:
    host: str
    port: int

    @classmethod
    def from_env(cls, environment: Mapping[str, str]) -> "ServerConfig":
        raw_port = environment.get("PORT", "8000").strip()
        try:
            port = int(raw_port)
        except ValueError as exc:
            raise RuntimeError("PORT must be an integer") from exc
        if not 1 <= port <= 65_535:
            raise RuntimeError("PORT must be between 1 and 65535")
        return cls(host="0.0.0.0", port=port)
