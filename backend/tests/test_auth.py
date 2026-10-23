from __future__ import annotations

from app import create_app
from config import Settings
from tests.conftest import PASSWORD


def test_protected_route_requires_session(client):
    assert client.get("/api/overview").status_code == 401


def test_login_sets_session_and_returns_user(client):
    response = client.post(
        "/api/auth/login", json={"username": "operator", "password": PASSWORD}
    )
    assert response.status_code == 200
    assert response.get_json()["username"] == "operator"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.get_json()["username"] == "operator"


def test_login_rejects_wrong_password(client):
    response = client.post(
        "/api/auth/login", json={"username": "operator", "password": "definitely-wrong"}
    )
    assert response.status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_login_rejects_unknown_user(client):
    response = client.post(
        "/api/auth/login", json={"username": "nobody", "password": PASSWORD}
    )
    assert response.status_code == 401


def test_logout_clears_session(auth_client):
    assert auth_client.get("/api/auth/me").status_code == 200
    assert auth_client.post("/api/auth/logout").status_code == 200
    assert auth_client.get("/api/auth/me").status_code == 401


def test_tampered_cookie_is_rejected(client):
    client.set_cookie("bee_session", "not-a-signed-session")
    assert client.get("/api/auth/me").status_code == 401


def test_login_unavailable_without_configured_operator(tmp_path):
    settings = Settings(
        app_env="development",
        secret_key="test-secret",
        database_url=f"sqlite:///{(tmp_path / 'empty.db').as_posix()}",
        app_password_hash="",
        bee_token="test-token",
        frontend_dist=str(tmp_path / "no-build"),
    )
    application = create_app(settings)
    application.config.update(TESTING=True)

    with application.test_client() as test_client:
        response = test_client.post(
            "/api/auth/login", json={"username": "operator", "password": "anything"}
        )
        assert response.status_code == 503

    application.extensions["bee_engine"].dispose()


def test_demo_login_disabled_by_default(client):
    response = client.get("/api/auth/demo")
    assert response.status_code == 200
    assert response.get_json() == {"enabled": False}


def test_demo_login_returns_configured_credentials(app, client):
    settings = app.extensions["bee_settings"]
    settings.demo_login_enabled = True
    settings.demo_password = "123456"

    response = client.get("/api/auth/demo")
    assert response.status_code == 200
    assert response.get_json() == {
        "enabled": True,
        "username": "operator",
        "password": "123456",
    }
    assert response.headers["Cache-Control"] == "no-store"


def test_demo_login_is_never_exposed_in_production(app, client):
    settings = app.extensions["bee_settings"]
    settings.demo_login_enabled = True
    settings.demo_password = "123456"
    settings.app_env = "production"

    assert client.get("/api/auth/demo").get_json() == {"enabled": False}

