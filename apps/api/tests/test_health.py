from fastapi.testclient import TestClient

from app import main


client = TestClient(main.app)


def test_health_is_dependency_free_and_stable() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "dcflens-api"}


def test_health_does_not_initialize_sec_cache_or_gemini(monkeypatch) -> None:
    def forbidden(*args, **kwargs):
        raise AssertionError("health must not initialize analysis dependencies")

    monkeypatch.setattr(main, "build_analysis_service", forbidden)
    application = main.create_app(main.settings)

    response = TestClient(application).get("/health")

    assert response.status_code == 200
    assert not hasattr(application.state, "analysis_service")
