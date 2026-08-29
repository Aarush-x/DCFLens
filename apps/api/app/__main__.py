from __future__ import annotations

import os

import uvicorn

from app.core.runtime import ServerConfig


def main() -> None:
    server = ServerConfig.from_env(os.environ)
    uvicorn.run("app.main:app", host=server.host, port=server.port)


if __name__ == "__main__":
    main()
