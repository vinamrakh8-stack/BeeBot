from __future__ import annotations

from sqlalchemy import select

from models import Conversation, Todo, User, utcnow


def _seed_other_owner(db) -> User:
    other = User(username="intruder", password_hash="unused")
    db.add(other)
    db.commit()
    db.refresh(other)

    db.add(
        Conversation(
            owner_id=other.id,
            bee_id=999,
            state="processed",
            summary="Private notes",
            short_summary="Private notes",
            synced_at=utcnow(),
        )
    )
    db.add(
        Todo(
            owner_id=other.id,
            bee_id=888,
            text="Someone else's task",
            completed=False,
            synced_at=utcnow(),
        )
    )
    db.commit()
    return other


def test_conversation_list_is_scoped_to_owner(auth_client, db):
    _seed_other_owner(db)

    body = auth_client.get("/api/conversations").get_json()
    assert body["total"] == 0
    assert body["items"] == []


def test_conversation_detail_is_scoped_to_owner(auth_client, db):
    _seed_other_owner(db)
    assert auth_client.get("/api/conversations/999").status_code == 404


def test_task_mutation_is_scoped_to_owner(auth_client, db):
    _seed_other_owner(db)
    response = auth_client.patch("/api/tasks/888", json={"completed": True})
    assert response.status_code == 404


def test_missing_session_cannot_read_own_rows(client):
    assert client.get("/api/memories").status_code == 401


def test_cross_origin_mutation_is_rejected(auth_client, fake, db):
    owner = db.execute(select(User)).scalars().first()
    fake.add_todo(777, "Mine")
    db.add(
        Todo(owner_id=owner.id, bee_id=777, text="Mine", completed=False, synced_at=utcnow())
    )
    db.commit()

    blocked = auth_client.patch(
        "/api/tasks/777", json={"completed": True}, headers={"Origin": "https://evil.example"}
    )
    assert blocked.status_code == 403

    allowed = auth_client.patch(
        "/api/tasks/777",
        json={"completed": True},
        headers={"Origin": "http://localhost:5173"},
    )
    assert allowed.status_code == 200
