"""Real urllib adapter regressions, with no network access."""
from http.client import IncompleteRead
from io import BytesIO
from urllib.error import HTTPError

import pytest

from app.data.sec.client import SecClient, SecClientConfig
from app.data.sec.errors import SecRequestError
from app.data.sec.transport import ResponseTooLarge, UrllibSecTransport


class BrokenResponse:
    headers = {}
    status = 200

    def __init__(self, error):
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, size):
        raise self.error

    def close(self):
        pass


@pytest.mark.parametrize("error", [
    ConnectionResetError("sensitive transport details"),
    IncompleteRead(b"partial", 100),
])
@pytest.mark.parametrize("http_error", [False, True])
def test_sec_broken_response_reads_follow_bounded_retries(monkeypatch, error, http_error):
    calls = []
    def opener(*args, **kwargs):
        calls.append(1)
        response = BrokenResponse(error)
        if http_error:
            raise HTTPError("https://data.sec.gov", 503, "Unavailable", {}, response)
        return response
    monkeypatch.setattr("urllib.request.urlopen", opener)
    client = SecClient(
        SecClientConfig(user_agent="DCFLens qa@example.com", max_retries=1),
        sleeper=lambda _: None,
    )
    with pytest.raises(SecRequestError) as failure:
        client.get_company_facts(320193)
    assert failure.value.attempts == 2
    assert len(calls) == 2
    assert "sensitive" not in str(failure.value)


@pytest.mark.parametrize("oversized", [False, True])
def test_sec_http_error_stream_is_closed(monkeypatch, oversized):
    stream = BytesIO(b"x" * (2048 if oversized else 10))
    def opener(*args, **kwargs):
        raise HTTPError("https://data.sec.gov", 403, "Forbidden", {}, stream)
    monkeypatch.setattr("urllib.request.urlopen", opener)
    transport = UrllibSecTransport()
    if oversized:
        with pytest.raises(ResponseTooLarge):
            transport.get("https://data.sec.gov", headers={}, timeout_seconds=1, max_response_bytes=1024)
    else:
        assert transport.get("https://data.sec.gov", headers={}, timeout_seconds=1, max_response_bytes=1024).status_code == 403
    assert stream.closed
