import pytest

from app import __main__ as entrypoint
from app.core.runtime import ServerConfig


def test_server_config_binds_all_interfaces_and_respects_render_port() -> None:
    config = ServerConfig.from_env({"PORT": "10000"})

    assert config.host == "0.0.0.0"
    assert config.port == 10000


def test_server_config_defaults_for_local_execution() -> None:
    assert ServerConfig.from_env({}).port == 8000


@pytest.mark.parametrize("port", ["zero", "0", "65536"])
def test_server_config_rejects_invalid_ports(port: str) -> None:
    with pytest.raises(RuntimeError, match="PORT"):
        ServerConfig.from_env({"PORT": port})


def test_container_entrypoint_uses_bounded_graceful_shutdown(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_run(import_path: str, **kwargs: object) -> None:
        captured["import_path"] = import_path
        captured.update(kwargs)

    monkeypatch.setattr(entrypoint.uvicorn, "run", fake_run)
    monkeypatch.setenv("PORT", "8765")

    entrypoint.main()

    assert captured == {
        "import_path": "app.main:app",
        "host": "0.0.0.0",
        "port": 8765,
        "timeout_graceful_shutdown": 25,
    }
