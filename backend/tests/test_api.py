from __future__ import annotations

from sqlalchemy import select

from models import Todo


def test_search_returns_results(auth_client, fake):
    fake.add_conversation(1, "Roadmap planning for Q3")

    response = auth_client.get("/api/search", query_string={"q": "Roadmap", "mode": "keyword"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["mode"] == "keyword"
    assert body["filter"] == "all"
    assert body["results"][0]["id"] == 1


def test_neural_search_reports_conversation_scope(auth_client, fake):
    fake.add_conversation(1, "Roadmap planning")

    body = auth_client.get(
        "/api/search", query_string={"q": "roadmap", "mode": "neural"}
    ).get_json()
    assert body["filter"] == "conversations"


def test_search_requires_a_query(auth_client):
    assert auth_client.get("/api/search", query_string={"q": ""}).status_code == 400


def test_search_surfaces_upstream_failure(auth_client, fake):
    fake.fail_next("/v1/search/conversations", 401)
    response = auth_client.get("/api/search", query_string={"q": "anything"})
    assert response.status_code == 401
    assert response.get_json()["error"] == "bee_auth_failed"


def test_task_completion_writes_through_to_bee(auth_client, fake, run_sync):
    fake.add_todo(10, "Call dentist")
    assert run_sync(full=True).status == "success"

    response = auth_client.patch("/api/tasks/10", json={"completed": True})
    assert response.status_code == 200
    assert response.get_json()["completed"] is True
    assert fake.todos[10]["completed"] is True
    assert fake.todo_updates == [(10, {"completed": True})]


def test_failed_task_update_is_not_mirrored(auth_client, fake, db, run_sync, monkeypatch):
    monkeypatch.setattr("services.bee_client.time.sleep", lambda *args, **kwargs: None)
    fake.add_todo(11, "Buy milk")
    assert run_sync(full=True).status == "success"

    fake.fail_next("/v1/todos/11", 500, times=5)
    response = auth_client.patch("/api/tasks/11", json={"completed": True})
    assert response.status_code == 503

    db.rollback()
    assert db.execute(select(Todo).where(Todo.bee_id == 11)).scalar_one().completed is False


def test_connection_status_reports_account(auth_client):
    response = auth_client.get("/api/bee/status")
    assert response.status_code == 200
    body = response.get_json()
    assert body["configured"] is True
    assert body["reachable"] is True
    assert body["account"]["name"] == "Test Operator"
    assert body["sync"]["last_synced_at"] is None


def test_connection_status_alias_matches_bee_status(auth_client):
    alias = auth_client.get("/api/connection/status")
    canonical = auth_client.get("/api/bee/status")
    assert alias.status_code == 200
    assert alias.get_json() == canonical.get_json()


def test_connection_status_reports_bee_failure(auth_client, fake):
    fake.fail_next("/v1/me", 401)
    body = auth_client.get("/api/bee/status").get_json()
    assert body["reachable"] is False
    assert body["error"]


def test_overview_counts_after_sync(auth_client, fake, run_sync):
    fake.add_conversation(101, "Roadmap discussion")
    fake.add_daily(201, "2026-02-02", "Busy day")
    fake.add_fact(301, "Prefers tea")
    fake.add_todo(401, "Call dentist")
    assert run_sync(full=True).status == "success"

    body = auth_client.get("/api/overview").get_json()
    assert body["counts"]["conversations"] == 1
    assert body["counts"]["daily_summaries"] == 1
    assert body["counts"]["facts"] == 1
    assert body["counts"]["todos_open"] == 1
    assert body["today_summary"]["bee_id"] == 201
    assert body["sync"]["last_synced_at"]


def test_conversation_detail_fetches_transcript(auth_client, fake, run_sync):
    fake.add_conversation(101, "Roadmap discussion")
    assert run_sync(full=True).status == "success"

    # Full sync stores the list projection only; opening hydrates the transcript.
    body = auth_client.get("/api/conversations/101").get_json()
    assert body["stale"] is False
    assert body["transcriptions"][0]["utterances"][0]["text"] == "Hello there"
    assert body["transcriptions"][0]["utterances"][0]["speaker"] == "speaker_1"


def test_privacy_summary_and_data_deletion(auth_client, fake, run_sync, db):
    fake.add_conversation(101, "Roadmap discussion")
    fake.add_fact(301, "Prefers tea")
    assert run_sync(full=True).status == "success"

    privacy = auth_client.get("/api/settings/privacy").get_json()
    assert privacy["stored"]["conversations"] == 1
    assert privacy["stored"]["memories"] == 1

    deleted = auth_client.delete("/api/data").get_json()
    assert deleted["deleted"]["conversations"] == 1

    db.rollback()
    assert auth_client.get("/api/settings/privacy").get_json()["stored"]["conversations"] == 0


def test_health_endpoint_is_public(client):
    body = client.get("/api/health").get_json()
    assert body["status"] == "ok"
    assert body["bee_configured"] is True
