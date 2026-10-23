from __future__ import annotations

import hashlib
from datetime import timedelta

from sqlalchemy import select

from models import MobileToken, utcnow
from tests.conftest import PASSWORD


def _pair(client, **overrides):
    payload = {
        "username": "operator",
        "password": PASSWORD,
        "device_name": "Test phone",
    }
    payload.update(overrides)
    return client.post("/api/mobile/pair", json=payload)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_pair_returns_token_once_and_stores_only_a_hash(client, db):
    response = _pair(client)
    assert response.status_code == 200, response.get_data(as_text=True)
    body = response.get_json()
    raw = body["token"]

    assert raw.startswith("bvp_")
    assert body["token_type"] == "Bearer"
    assert body["user"]["username"] == "operator"
    assert body["device"]["device_name"] == "Test phone"
    assert response.headers["Cache-Control"] == "no-store"

    db.expire_all()
    stored = db.execute(select(MobileToken)).scalar_one()
    assert stored.token_hash == hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert raw not in stored.token_hash
    assert stored.revoked_at is None


def test_bearer_token_authenticates_without_a_cookie(client, db):
    raw = _pair(client).get_json()["token"]

    me = client.get("/api/auth/me", headers=_auth(raw))
    assert me.status_code == 200
    assert me.get_json()["username"] == "operator"

    overview = client.get("/api/overview", headers=_auth(raw))
    assert overview.status_code == 200
    assert "counts" in overview.get_json()

    db.expire_all()
    assert db.execute(select(MobileToken)).scalar_one().last_used_at is not None


def test_pair_rejects_wrong_password(client):
    response = _pair(client, password="definitely-wrong")
    assert response.status_code == 401
    assert response.get_json()["error"] == "invalid_credentials"


def test_pair_rejects_unknown_user(client):
    response = _pair(client, username="nobody")
    assert response.status_code == 401


def test_invalid_bearer_is_rejected_even_with_a_web_session(auth_client):
    assert auth_client.get("/api/auth/me", headers=_auth("bvp_not-a-token")).status_code == 401


def test_expired_token_is_rejected(client, db):
    raw = _pair(client).get_json()["token"]
    db.expire_all()
    token = db.execute(select(MobileToken)).scalar_one()
    token.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert client.get("/api/auth/me", headers=_auth(raw)).status_code == 401


def test_current_device_can_be_revoked(client, db):
    raw = _pair(client).get_json()["token"]
    response = client.delete("/api/mobile/session", headers=_auth(raw))
    assert response.status_code == 200
    assert response.get_json()["revoked"] is True
    assert client.get("/api/auth/me", headers=_auth(raw)).status_code == 401

    db.expire_all()
    assert db.execute(select(MobileToken)).scalar_one().revoked_at is not None


def test_web_session_can_list_and_revoke_paired_devices(client, auth_client):
    raw = _pair(client).get_json()["token"]
    assert auth_client.post(
        "/api/auth/login", json={"username": "operator", "password": PASSWORD}
    ).status_code == 200

    listed = auth_client.get("/api/mobile/devices")
    assert listed.status_code == 200
    devices = listed.get_json()
    assert len(devices) == 1
    assert devices[0]["device_name"] == "Test phone"
    assert "token_hash" not in devices[0]

    revoked = auth_client.delete(f"/api/mobile/devices/{devices[0]['id']}")
    assert revoked.status_code == 200
    assert client.get("/api/auth/me", headers=_auth(raw)).status_code == 401


def test_bearer_requests_are_not_csrf_blocked(client):
    raw = _pair(client).get_json()["token"]
    response = client.post(
        "/api/tasks",
        json={"text": "Created from a paired phone"},
        headers={**_auth(raw), "Origin": "https://not-the-dashboard.example"},
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    assert response.get_json()["text"] == "Created from a paired phone"


def test_pairing_is_rate_limited(client):
    for _ in range(5):
        assert _pair(client, password="wrong").status_code == 401
    limited = _pair(client, password="wrong")
    assert limited.status_code == 429
    assert limited.get_json()["error"] == "rate_limited"
    assert "pairing" in limited.get_json()["message"].lower()
    assert "Retry-After" in limited.headers


def test_mobile_session_describes_capabilities_without_credentials(client):
    raw = _pair(client).get_json()["token"]
    response = client.get("/api/mobile/session", headers=_auth(raw))
    assert response.status_code == 200
    body = response.get_json()

    assert body["api_version"] == "phase3"
    assert body["capabilities"]["wake_word"]["mode"] == "on_device_optional"
    assert body["capabilities"]["audio_output"] == "os_default_route"
    assert body["capabilities"]["updates"] == "foreground_polling"
    assert "bee_token" not in body
    assert "ai_api_key" not in body
