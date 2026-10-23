from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app import create_app
from config import Settings
from models import User
from security import hash_password
from services.bee_client import BeeClient
from services.sync_service import SyncService
from tests.fake_ai import FakeAI
from tests.fake_bee import FakeBee

PASSWORD = "correct-horse-battery-staple"
PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="development",
        secret_key="test-secret-key-not-for-production",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        app_username="operator",
        app_password_hash=PASSWORD_HASH,
        demo_login_enabled=False,
        demo_password="",
        cors_origins="http://localhost:5173",
        frontend_dist=str(tmp_path / "no-frontend-build"),
        bee_api_mode="token",
        bee_token="test-token",
        bee_timeout_seconds=2.0,
        bee_max_retries=2,
        bee_sync_page_size=2,
        bee_sync_max_pages=10,
    )


@pytest.fixture
def fake() -> FakeBee:
    return FakeBee()


@pytest.fixture
def fake_ai() -> FakeAI:
    return FakeAI()


@pytest.fixture
def app(settings: Settings, fake: FakeBee, fake_ai: FakeAI):
    application = create_app(settings)
    application.config.update(TESTING=True)
    application.extensions["bee_client"] = BeeClient(
        settings, transport=httpx.MockTransport(fake.handler)
    )
    application.extensions["ai_client"] = fake_ai

    yield application

    application.extensions["bee_client"].close()
    application.extensions["bee_engine"].dispose()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth_client(client):
    response = client.post(
        "/api/auth/login", json={"username": "operator", "password": PASSWORD}
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client


@pytest.fixture
def db(app):
    with app.extensions["bee_session_factory"]() as session:
        yield session


@pytest.fixture
def run_sync(app):
    """Run a sync in its own session (the service owns its transaction)."""

    def _run(full: bool = False, owner_id: int | None = None):
        factory = app.extensions["bee_session_factory"]
        settings = app.extensions["bee_settings"]
        client = app.extensions["bee_client"]
        with factory() as session:
            if owner_id is None:
                owner_id = session.execute(select(User.id)).scalars().first()
            assert owner_id is not None, "operator user missing"
            return SyncService(session, client, settings, int(owner_id)).run(
                trigger="test", full=full
            )

    return _run
