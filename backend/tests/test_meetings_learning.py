from __future__ import annotations

from sqlalchemy import select

from models import Conversation


def _conversation_id(db) -> int:
    db.rollback()
    return db.execute(select(Conversation.id)).scalar_one()


def test_meeting_creation_links_source_and_generates_summary(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(41, "Weekly product sync")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/41")
    conversation_id = _conversation_id(db)

    created = auth_client.post(
        "/api/meetings", json={"conversation_id": conversation_id}
    )
    assert created.status_code == 201
    meeting = created.get_json()
    assert meeting["source_kind"] == "conversation"
    assert meeting["conversation_bee_id"] == 41
    assert meeting["participants"] == ["speaker 1"]

    fake_ai.json_response = {
        "summary": "The team reviewed the product plan.",
        "key_points": ["Product plan", "Launch date"],
        "decisions": ["Ship on Friday"],
        "action_items": [{"text": "Prepare release notes", "due_at": "2026-02-06"}],
    }
    generated = auth_client.post(f"/api/meetings/{meeting['id']}/generate")
    assert generated.status_code == 200
    body = generated.get_json()
    assert body["ai_generated"] is True
    assert body["decisions"] == ["Ship on Friday"]
    assert body["action_items"][0]["text"] == "Prepare release notes"
    assert body["conversation_bee_id"] == 41


def test_manual_meeting_cannot_be_generated_without_source(auth_client):
    created = auth_client.post(
        "/api/meetings", json={"title": "Manual notes", "summary": "Typed by the user"}
    )
    assert created.status_code == 201
    response = auth_client.post(f"/api/meetings/{created.get_json()['id']}/generate")
    assert response.status_code == 400
    assert response.get_json()["error"] == "insufficient_source"


def test_learning_generation_progress_and_manual_items(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(51, "We learned about database indexes.")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/51")
    conversation_id = _conversation_id(db)

    created = auth_client.post(
        "/api/learning", json={"title": "Database indexes", "conversation_id": conversation_id}
    )
    assert created.status_code == 201
    set_id = created.get_json()["id"]

    fake_ai.json_response = {
        "notes": "An index speeds up reads but costs writes.",
        "goals": ["Understand index trade-offs"],
        "flashcards": [
            {"question": "What does an index speed up?", "answer": "Reads", "explanation": None}
        ],
        "quiz": [
            {"question": "What does an index cost?", "answer": "Writes", "explanation": "More write work"}
        ],
    }
    generated = auth_client.post(f"/api/learning/{set_id}/generate")
    assert generated.status_code == 200
    detail = generated.get_json()
    assert detail["ai_generated"] is True
    assert detail["item_count"] == 2
    assert detail["notes"].startswith("An index")

    manual = auth_client.post(
        f"/api/learning/{set_id}/items",
        json={"kind": "flashcard", "question": "My own card", "answer": "My answer"},
    )
    assert manual.status_code == 201
    item_id = manual.get_json()["id"]

    updated = auth_client.patch(
        f"/api/learning/items/{item_id}", json={"status": "mastered", "reviews": 2}
    )
    assert updated.status_code == 200
    assert updated.get_json()["status"] == "mastered"

    regenerated = auth_client.post(f"/api/learning/{set_id}/generate").get_json()
    assert regenerated["item_count"] == 3
    assert any(item["question"] == "My own card" for item in regenerated["items"])


def test_manual_learning_set_generate_requires_source(auth_client):
    created = auth_client.post("/api/learning", json={"title": "Manual set"})
    assert created.status_code == 201
    response = auth_client.post(f"/api/learning/{created.get_json()['id']}/generate")
    assert response.status_code == 400
