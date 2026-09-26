import pytest
from fastapi.testclient import TestClient


def client(monkeypatch, base="/api"):
    monkeypatch.setenv("DOCUMENT_API_BASE_URL", base)
    from console.app import create_app
    return TestClient(create_app())


def test_shell_and_assets_are_private(monkeypatch):
    with client(monkeypatch) as c:
        for path in ["/", "/static/app.js", "/config"]:
            response = c.get(path)
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["referrer-policy"] == "no-referrer"
            assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
        assert "Document Intelligence" in c.get("/").text
        assert c.get("/config").json() == {"apiBaseUrl": "/api"}


def test_health_is_local_and_host_never_accepts_uploads(monkeypatch):
    with client(monkeypatch) as c:
        assert c.get("/healthz").json() == {"status": "ok", "service": "document-console"}
        assert c.post("/api/v1/documents/scan", json={"document_type": "driver_license"}).status_code == 404


def test_external_api_origin_added_to_csp(monkeypatch):
    with client(monkeypatch, "https://api.example.test/v1/") as c:
        assert c.get("/config").json()["apiBaseUrl"] == "https://api.example.test/v1"
        assert "connect-src 'self' https://api.example.test" in c.get("/").headers["content-security-policy"]


@pytest.mark.parametrize("base", ["//evil.test", "http://api.test", "https://user:pass@api.test", "/api?x=1", "https://api.test/#x", "/api;bad", "https://api.test/\n"])
def test_invalid_config_fails_closed(monkeypatch, base):
    monkeypatch.setenv("DOCUMENT_API_BASE_URL", base)
    from console.app import create_app
    with pytest.raises(ValueError):
        create_app()
