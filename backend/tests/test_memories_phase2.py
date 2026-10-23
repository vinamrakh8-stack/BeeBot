from __future__ import annotations

from sqlalchemy import select

from models import Conversation, Fact, SyncTombstone


def test_create_edit_and_delete_local_memory(auth_client, db):
    created = auth_client.post(
        "/api/memories",
        json={"text": "I prefer green tea", "tags": ["preference"]},
    )
    assert created.status_code == 201
    body = created.get_json()
    assert body["origin"] == "user"
    assert body["bee_id"] < 0
    bee_id = body["bee_id"]

    updated = auth_client.patch(
        f"/api/memories/{bee_id}",
        json={"text": "I prefer jasmine tea", "confirmed": False},
    )
    assert updated.status_code == 200
    assert updated.get_json()["text"] == "I prefer jasmine tea"
    assert updated.get_json()["confirmed"] is False

    deleted = auth_client.delete(f"/api/memories/{bee_id}")
    assert deleted.status_code == 200

    db.rollback()
    assert db.execute(select(Fact).where(Fact.bee_id == bee_id)).scalar_one_or_none() is None


def test_editing_bee_memory_tombstones_it(auth_client, fake, run_sync, db):
    fake.add_fact(301, "Prefers tea")
    assert run_sync(full=True).status == "success"

    response = auth_client.patch("/api/memories/301", json={"text": "Prefers green tea"})
    assert response.status_code == 200
    assert response.get_json()["origin"] == "user"

    db.rollback()
    tombstone = db.execute(
        select(SyncTombstone).where(
            SyncTombstone.entity == "fact", SyncTombstone.source_id == 301
        )
    ).scalar_one()
    assert tombstone is not None

    second = run_sync(full=True)
    assert second.counts["facts"].get("tombstoned") == 1
    db.rollback()
    assert db.execute(select(Fact.text).where(Fact.bee_id == 301)).scalar_one() == "Prefers green tea"


def test_deleting_bee_memory_is_not_recreated_by_sync(auth_client, fake, run_sync, db):
    fake.add_fact(302, "Lives in Pune")
    assert run_sync(full=True).status == "success"
    assert auth_client.delete("/api/memories/302").status_code == 200

    assert run_sync(full=True).status == "success"
    db.rollback()
    assert db.execute(select(Fact).where(Fact.bee_id == 302)).scalar_one_or_none() is None


def test_memory_extraction_returns_candidates_without_persisting(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(11, "We decided to use PostgreSQL for the project.")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/11")  # hydrate transcript / detail

    fake_ai.json_response = {
        "candidates": [
            {
                "text": "Uses PostgreSQL for the project",
                "tags": ["project"],
                "confidence": 0.8,
                "excerpt": "We decided to use PostgreSQL for the project.",
            }
        ]
    }
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()
    response = auth_client.post(
        "/api/memories/extract", json={"conversation_id": conversation_id}
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["persisted"] is False
    assert body["candidates"][0]["text"] == "Uses PostgreSQL for the project"
    assert body["source"]["bee_id"] == 11

    db.rollback()
    assert db.execute(select(Fact).where(Fact.owner_id.is_not(None))).scalars().all() == []


def test_memory_validation(auth_client):
    assert auth_client.post("/api/memories", json={"text": ""}).status_code == 400
    assert auth_client.post("/api/memories", json={"text": "x", "tags": "nope"}).status_code == 400
    assert auth_client.patch("/api/memories/-999", json={"text": "x"}).status_code == 404


def test_memory_extraction_and_source_link_accept_bee_id(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(12, "The team standardised on PostgreSQL.")
    assert run_sync(full=True).status == "success"
    assert auth_client.get("/api/conversations/12").status_code == 200
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()

    fake_ai.json_response = {
        "candidates": [
            {
                "text": "Standardised on PostgreSQL",
                "tags": ["project"],
                "confidence": 0.9,
                "excerpt": "The team standardised on PostgreSQL.",
            }
        ]
    }
    extracted = auth_client.post("/api/memories/extract", json={"bee_id": 12})
    assert extracted.status_code == 200
    body = extracted.get_json()
    assert body["source"]["conversation_id"] == conversation_id
    assert body["source"]["bee_id"] == 12
    assert body["candidates"][0]["text"] == "Standardised on PostgreSQL"

    created = auth_client.post(
        "/api/memories",
        json={"text": "Uses PostgreSQL", "source_bee_id": 12},
    )
    assert created.status_code == 201
    assert created.get_json()["source_conversation_id"] == conversation_id
    assert created.get_json()["source_kind"] == "conversation"

    missing = auth_client.post("/api/memories/extract", json={})
    assert missing.status_code == 400
    assert auth_client.post(
        "/api/memories/extract", json={"bee_id": 9999}
    ).status_code == 404
