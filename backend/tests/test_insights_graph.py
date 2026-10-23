from __future__ import annotations

from sqlalchemy import select

from models import Conversation


def test_insights_empty_state_is_explicit(auth_client):
    body = auth_client.get("/api/insights", query_string={"period": "day"}).get_json()
    assert body["sufficient_data"] is False
    assert body["counts"]["conversations"] == 0
    assert "not productivity" in body["notes"]


def test_insights_use_actual_records(auth_client, fake, run_sync):
    fake.add_conversation(61, "Roadmap discussion")
    fake.add_todo(62, "Draft roadmap")
    assert run_sync(full=True).status == "success"

    body = auth_client.get(
        "/api/insights", query_string={"period": "day", "date": "2026-02-02"}
    ).get_json()
    assert body["sufficient_data"] is True
    assert body["counts"]["conversations"] == 1
    assert body["conversations"][0]["route"] == "/conversations/61"
    assert body["trends"][0]["basis"] == "stored record counts"


def test_insights_reject_invalid_period(auth_client):
    assert auth_client.get("/api/insights", query_string={"period": "month"}).status_code == 400
    assert auth_client.get("/api/insights", query_string={"date": "nope"}).status_code == 400


def test_knowledge_graph_contains_source_linked_nodes(auth_client, fake, run_sync, db):
    fake.add_conversation(71, "Roadmap discussion")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/71")
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()

    memory = auth_client.post(
        "/api/memories",
        json={
            "text": "The roadmap prioritizes reliability",
            "source_conversation_id": conversation_id,
        },
    ).get_json()
    task = auth_client.post(
        "/api/tasks",
        json={"text": "Send roadmap", "source_conversation_id": conversation_id},
    ).get_json()

    graph = auth_client.get("/api/knowledge-graph").get_json()
    node_ids = {node["id"] for node in graph["nodes"]}
    assert f"conversation:{conversation_id}" in node_ids
    assert f"memory:{memory['bee_id']}" in node_ids
    assert f"task:{task['bee_id']}" in node_ids
    assert any(edge["relation"] == "source_conversation" for edge in graph["edges"])


def test_user_confirmed_graph_edge_crud(auth_client, fake, run_sync, db):
    fake.add_conversation(72, "Planning")
    assert run_sync(full=True).status == "success"
    auth_client.get("/api/conversations/72")
    db.rollback()
    conversation_id = db.execute(select(Conversation.id)).scalar_one()
    memory = auth_client.post("/api/memories", json={"text": "Planning memory"}).get_json()

    from_ref = f"conversation:{conversation_id}"
    to_ref = f"memory:{memory['bee_id']}"
    created = auth_client.post(
        "/api/knowledge-graph/edges",
        json={"from_ref": from_ref, "to_ref": to_ref, "relation": "related_to"},
    )
    assert created.status_code == 201
    edge_id = created.get_json()["id"].split(":", 1)[1]

    duplicate = auth_client.post(
        "/api/knowledge-graph/edges",
        json={"from_ref": from_ref, "to_ref": to_ref, "relation": "related_to"},
    )
    assert duplicate.status_code == 409

    graph = auth_client.get("/api/knowledge-graph").get_json()
    assert any(edge["id"] == f"stored:{edge_id}" for edge in graph["edges"])

    assert auth_client.delete(f"/api/knowledge-graph/edges/{edge_id}").status_code == 200


def test_local_search_does_not_require_bee(auth_client, fake, run_sync):
    fake.add_conversation(81, "Roadmap planning")
    assert run_sync(full=True).status == "success"

    response = auth_client.get("/api/search/local", query_string={"q": "roadmap"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["mode"] == "local"
    assert body["items"][0]["kind"] == "conversation"

    assert auth_client.get("/api/search/local", query_string={"q": ""}).status_code == 400
