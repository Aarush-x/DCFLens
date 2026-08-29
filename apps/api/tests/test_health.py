from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_is_dependency_free_and_stable() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "dcflens-api"}
