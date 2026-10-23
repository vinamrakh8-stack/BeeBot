from __future__ import annotations

from sqlalchemy import select

from models import (
    Conversation,
    KnowledgeEdge,
    LearningItem,
    LearningSet,
    Meeting,
    User,
    utcnow,
)


def _local_conversation_id(db) -> int:
    db.rollback()
    return int(db.execute(select(Conversation.id)).scalar_one())


def test_source_links_expose_bee_conversation_id(auth_client, fake, run_sync, db):
    fake.add_conversation(90, "We agreed to ship the beta.")
    assert run_sync(full=True).status == "success"
    assert auth_client.get("/api/conversations/90").status_code == 200
    local_id = _local_conversation_id(db)

    memory = auth_client.post(
        "/api/memories",
        json={"text": "Ships the beta soon", "source_conversation_id": local_id},
    )
    assert memory.status_code == 201
    assert memory.get_json()["source_conversation_bee_id"] == 90

    task = auth_client.post(
        "/api/tasks", json={"text": "Ship the beta", "source_bee_id": 90}
    )
    assert task.status_code == 201
    assert task.get_json()["source_conversation_bee_id"] == 90

    memories = auth_client.get("/api/memories").get_json()["items"]
    tasks = auth_client.get("/api/tasks").get_json()["items"]
    assert {item["source_conversation_bee_id"] for item in memories} == {90}
    assert {item["source_conversation_bee_id"] for item in tasks} == {90}


def test_ai_origin_is_persisted_honestly(auth_client, db):
    memory = auth_client.post(
        "/api/memories",
        json={"text": "Uses PostgreSQL", "origin": "ai", "confirmed": False},
    )
    assert memory.status_code == 201
    body = memory.get_json()
    assert body["origin"] == "ai"
    assert body["ai_generated"] is True
    assert body["confirmed"] is False

    task = auth_client.post(
        "/api/tasks", json={"text": "Send the update", "origin": "ai"}
    )
    assert task.status_code == 201
    assert task.get_json()["origin"] == "ai"
    assert task.get_json()["ai_generated"] is True

    # ai_generated alone is enough to avoid mislabelling the row as user data.
    implied = auth_client.post(
        "/api/tasks", json={"text": "Review the draft", "ai_generated": True}
    )
    assert implied.status_code == 201
    assert implied.get_json()["origin"] == "ai"

    # Sync owns the `bee` provenance and clients cannot claim it.
    assert (
        auth_client.post(
            "/api/memories", json={"text": "Not from Bee", "origin": "bee"}
        ).status_code
        == 400
    )
    assert (
        auth_client.post(
            "/api/tasks", json={"text": "Not from Bee", "ai_generated": "yes"}
        ).status_code
        == 400
    )


def test_query_without_searchable_terms_returns_no_evidence(
    auth_client, fake, run_sync, fake_ai
):
    fake.add_conversation(91, "Roadmap planning for Q3")
    assert run_sync(full=True).status == "success"

    chat = auth_client.post("/api/assistant/chat", json={"message": "???"})
    assert chat.status_code == 200
    body = chat.get_json()
    assert body["clarification_needed"] is True
    assert body["grounded"] is False
    assert body["sources"] == []
    assert fake_ai.calls == []

    search = auth_client.get("/api/search/local", query_string={"q": "???"})
    assert search.status_code == 200
    assert search.get_json()["items"] == []


def test_learning_revision_plan_roundtrip_and_generation(
    auth_client, fake, run_sync, fake_ai, db
):
    fake.add_conversation(92, "Indexes speed up reads but slow writes.")
    assert run_sync(full=True).status == "success"
    local_id = _local_conversation_id(db)

    created = auth_client.post(
        "/api/learning",
        json={
            "title": "Database indexes",
            "conversation_id": local_id,
            "revision_plan": ["Day 1: review the notes (20 minutes)"],
        },
    )
    assert created.status_code == 201
    set_id = created.get_json()["id"]
    assert created.get_json()["revision_plan"] == [
        "Day 1: review the notes (20 minutes)"
    ]

    patched = auth_client.patch(
        f"/api/learning/{set_id}",
        json={"revision_plan": ["Day 1: notes", "Day 2: flashcards"]},
    )
    assert patched.status_code == 200
    assert patched.get_json()["revision_plan"] == [
        "Day 1: notes",
        "Day 2: flashcards",
    ]

    assert (
        auth_client.patch(
            f"/api/learning/{set_id}", json={"revision_plan": "not-a-list"}
        ).status_code
        == 400
    )

    fake_ai.json_response = {
        "notes": "An index trades write cost for read speed.",
        "goals": ["Explain the trade-off"],
        "revision_plan": ["Day 1: read notes", "Day 2: quiz yourself"],
        "flashcards": [
            {
                "question": "What does an index speed up?",
                "answer": "Reads",
                "explanation": "It avoids a full table scan.",
            }
        ],
        "quiz": [],
    }
    generated = auth_client.post(f"/api/learning/{set_id}/generate")
    assert generated.status_code == 200
    assert generated.get_json()["revision_plan"] == [
        "Day 1: read notes",
        "Day 2: quiz yourself",
    ]

    db.rollback()
    stored = db.get(LearningSet, set_id)
    assert stored is not None
    assert stored.revision_plan == ["Day 1: read notes", "Day 2: quiz yourself"]


def test_insight_commitment_links_use_bee_conversation_id(
    auth_client, fake, run_sync, db
):
    fake.add_conversation(93, "We will send the proposal.")
    assert run_sync(full=True).status == "success"
    local_id = _local_conversation_id(db)

    created = auth_client.post(
        "/api/tasks",
        json={
            "text": "Send the proposal",
            "due_at": "2026-02-10T09:00:00Z",
            "source_conversation_id": local_id,
        },
    )
    assert created.status_code == 201

    body = auth_client.get(
        "/api/insights", query_string={"period": "day", "date": "2026-02-02"}
    ).get_json()
    commitment = next(item for item in body["commitments"] if item["source"] == "task")
    assert commitment["route"] == "/conversations/93"


def test_export_privacy_and_purge_cover_phase2_records(
    auth_client, fake, run_sync, db
):
    fake.add_conversation(94, "Planning the launch.")
    assert run_sync(full=True).status == "success"
    local_id = _local_conversation_id(db)

    meeting = auth_client.post(
        "/api/meetings",
        json={"conversation_id": local_id, "title": "Launch planning"},
    )
    assert meeting.status_code == 201

    learning = auth_client.post(
        "/api/learning", json={"title": "Launch notes"}
    ).get_json()
    auth_client.post(
        f"/api/learning/{learning['id']}/items",
        json={"question": "When is launch?", "answer": "Soon"},
    )
    auth_client.post(
        "/api/knowledge-graph/edges",
        json={
            "from_ref": f"conversation:{local_id}",
            "to_ref": f"learning:{learning['id']}",
            "relation": "related_to",
        },
    )

    privacy = auth_client.get("/api/settings/privacy").get_json()
    assert privacy["stored"]["meetings"] == 1
    assert privacy["stored"]["learning_sets"] == 1
    assert privacy["stored"]["learning_items"] == 1
    assert privacy["stored"]["knowledge_edges"] >= 1

    exported = auth_client.get("/api/data/export")
    assert exported.status_code == 200
    assert "attachment" in exported.headers["Content-Disposition"]
    payload = exported.get_json()
    assert payload["format"] == "bee-voice-plus-export"
    assert payload["counts"]["meetings"] == 1
    assert payload["counts"]["learning_items"] == 1
    assert payload["learning_sets"][0]["items"][0]["answer"] == "Soon"
    assert payload["meetings"][0]["title"] == "Launch planning"
    assert payload["knowledge_edges"]

    deleted = auth_client.delete("/api/data")
    assert deleted.status_code == 200
    counts = deleted.get_json()["deleted"]
    assert counts["meetings"] == 1
    assert counts["learning_sets"] == 1
    assert counts["learning_items"] == 1
    assert counts["knowledge_edges"] >= 1

    after = auth_client.get("/api/data/export").get_json()
    assert sum(after["counts"].values()) == 0

    db.rollback()
    assert db.execute(select(Meeting)).scalars().all() == []
    assert db.execute(select(LearningSet)).scalars().all() == []
    assert db.execute(select(LearningItem)).scalars().all() == []
    assert db.execute(select(KnowledgeEdge)).scalars().all() == []


def test_phase2_records_and_export_are_owner_scoped(auth_client, db):
    other = User(username="intruder", password_hash="unused")
    db.add(other)
    db.commit()
    db.refresh(other)

    db.add(
        Meeting(
            owner_id=other.id,
            title="Someone else's meeting",
            source_kind="manual",
            ai_generated=False,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    other_set = LearningSet(
        owner_id=other.id,
        title="Someone else's set",
        source_kind="manual",
        ai_generated=False,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(other_set)
    db.commit()
    db.refresh(other_set)
    db.add(
        LearningItem(
            set_id=other_set.id,
            kind="flashcard",
            question="Private?",
            answer="Yes",
            status="new",
            reviews=0,
            ai_generated=False,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
    )
    db.add(
        KnowledgeEdge(
            owner_id=other.id,
            from_type="conversation",
            from_ref="conversation:999",
            to_type="memory",
            to_ref="memory:999",
            relation="related_to",
            confidence=1.0,
            created_at=utcnow(),
        )
    )
    db.commit()

    assert auth_client.get("/api/meetings").get_json()["items"] == []
    assert auth_client.get("/api/learning").get_json()["items"] == []
    assert auth_client.get(f"/api/learning/{other_set.id}").status_code == 404

    exported = auth_client.get("/api/data/export").get_json()
    assert exported["counts"]["meetings"] == 0
    assert exported["counts"]["learning_sets"] == 0
    assert exported["counts"]["learning_items"] == 0
    assert exported["counts"]["knowledge_edges"] == 0
