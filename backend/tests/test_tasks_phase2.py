from __future__ import annotations

from sqlalchemy import select

from models import Conversation, SyncTombstone, Todo


def test_create_duplicate_and_update_local_task(auth_client, db):
    created = auth_client.post(
        "/api/tasks", json={"text": "Email the architect", "due_at": "2026-02-05T10:00:00Z"}
    )
    assert created.status_code == 201
    body = created.get_json()
    assert body["origin"] == "user"
    assert body["bee_id"] < 0
    assert body["due_at"].startswith("2026-02-05")
    bee_id = body["bee_id"]

    duplicate = auth_client.post("/api/tasks", json={"text": "Email the architect"})
    assert duplicate.status_code == 409
    assert duplicate.get_json()["error"] == "duplicate_task"

    updated = auth_client.patch(
        f"/api/tasks/{bee_id}",
        json={"postponed_until": "2026-02-10T09:00:00Z", "completed": True},
    )
    assert updated.status_code == 200
    assert updated.get_json()["completed"] is True
    assert updated.get_json()["postponed_until"] is None

    assert auth_client.delete(f"/api/tasks/{bee_id}").status_code == 200
    db.rollback()
    assert db.execute(select(Todo).where(Todo.bee_id == bee_id)).scalar_one_or_none() is None


def test_task_extraction_and_dedupe_flag(auth_client, fake, run_sync, fake_ai, db):
    fake.add_conversation(21, "We agreed to send the proposal by Friday.")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/21")
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()

    fake_ai.json_response = {
        "candidates": [
            {
                "text": "Send the proposal",
                "due_at": "2026-02-06",
                "confidence": 0.9,
                "excerpt": "send the proposal by Friday",
            }
        ]
    }
    response = auth_client.post(
        "/api/tasks/extract", json={"conversation_id": conversation_id}
    )
    assert response.status_code == 200
    candidate = response.get_json()["candidates"][0]
    assert candidate["text"] == "Send the proposal"
    assert candidate["duplicate"] is False
    assert candidate["due_at"].startswith("2026-02-06")

    # Saving the same source-backed task should be idempotent at the app level.
    create = auth_client.post(
        "/api/tasks",
        json={
            "text": "Send the proposal",
            "due_at": candidate["due_at"],
            "source_conversation_id": conversation_id,
        },
    )
    assert create.status_code == 201

    second = auth_client.post(
        "/api/tasks/extract", json={"conversation_id": conversation_id}
    )
    assert second.get_json()["candidates"][0]["duplicate"] is True


def test_editing_bee_task_tombstones_and_preserves_local_change(
    auth_client, fake, run_sync, db
):
    fake.add_todo(31, "Call the bank")
    assert run_sync(full=True).status == "success"

    response = auth_client.patch("/api/tasks/31", json={"text": "Call the bank about the loan"})
    assert response.status_code == 200
    assert response.get_json()["origin"] == "user"

    assert run_sync(full=True).status == "success"
    db.rollback()
    assert (
        db.execute(select(Todo.text).where(Todo.bee_id == 31)).scalar_one()
        == "Call the bank about the loan"
    )
    assert db.execute(
        select(SyncTombstone).where(
            SyncTombstone.entity == "todo", SyncTombstone.source_id == 31
        )
    ).scalar_one()


def test_deleting_bee_task_is_not_recreated(auth_client, fake, run_sync, db):
    fake.add_todo(32, "Old commitment")
    assert run_sync(full=True).status == "success"
    assert auth_client.delete("/api/tasks/32").status_code == 200
    assert run_sync(full=True).status == "success"
    db.rollback()
    assert db.execute(select(Todo).where(Todo.bee_id == 32)).scalar_one_or_none() is None


def test_task_validation(auth_client):
    assert auth_client.post("/api/tasks", json={"text": ""}).status_code == 400
    assert auth_client.patch("/api/tasks/-999", json={"completed": True}).status_code == 404


def test_task_extraction_and_source_link_accept_bee_id(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(22, "Please send the update by Friday.")
    assert run_sync(full=True).status == "success"
    assert auth_client.get("/api/conversations/22").status_code == 200
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()

    fake_ai.json_response = {
        "candidates": [
            {
                "text": "Send the update",
                "due_at": "2026-02-06",
                "confidence": 0.85,
                "excerpt": "send the update by Friday",
            }
        ]
    }
    extracted = auth_client.post("/api/tasks/extract", json={"bee_id": 22})
    assert extracted.status_code == 200
    body = extracted.get_json()
    assert body["source"]["conversation_id"] == conversation_id
    assert body["candidates"][0]["due_at"].startswith("2026-02-06")

    created = auth_client.post(
        "/api/tasks",
        json={"text": "Send the update", "source_bee_id": 22},
    )
    assert created.status_code == 201
    assert created.get_json()["source_conversation_id"] == conversation_id

    missing_source = auth_client.post("/api/tasks/extract", json={})
    assert missing_source.status_code == 400
    unknown = auth_client.post("/api/tasks/extract", json={"bee_id": 9999})
    assert unknown.status_code == 404
