from __future__ import annotations

from sqlalchemy import select

from models import Conversation, DailySummary, Fact, SyncState, Todo


def seed_all(fake):
    fake.add_conversation(101, "Roadmap discussion", start_offset=1_000)
    fake.add_conversation(102, "Lunch chat", start_offset=2_000)
    fake.add_daily(201, "2026-02-02", "Busy day")
    fake.add_fact(301, "Prefers tea", confirmed=True)
    fake.add_fact(302, "Considering a new laptop", confirmed=False)
    fake.add_todo(401, "Call dentist")


def test_full_sync_persists_documented_entities(run_sync, fake, db):
    seed_all(fake)
    result = run_sync(full=True)

    assert result.status == "success", result.error
    assert result.mode == "full"
    assert result.counts["conversations"]["inserted"] == 2
    assert result.counts["facts"]["inserted"] == 2
    assert result.counts["todos"]["inserted"] == 1
    assert result.counts["daily"]["inserted"] == 1

    db.rollback()
    conversations = db.execute(select(Conversation)).scalars().all()
    facts = db.execute(select(Fact)).scalars().all()
    daily = db.execute(select(DailySummary)).scalars().all()

    assert len(conversations) == 2
    assert len(facts) == 2
    assert len(db.execute(select(Todo)).scalars().all()) == 1
    assert len(daily) == 1

    roadmap = next(row for row in conversations if row.bee_id == 101)
    assert roadmap.summary == "Roadmap discussion"
    assert roadmap.state == "processed"
    assert roadmap.start_time is not None

    assert next(row for row in facts if row.bee_id == 302).confirmed is False
    assert daily[0].day.isoformat() == "2026-02-02"
    assert daily[0].conversations_count == 2


def test_full_sync_is_idempotent(run_sync, fake, db):
    seed_all(fake)
    assert run_sync(full=True).status == "success"

    second = run_sync(full=True)
    assert second.status == "success"
    assert second.counts["conversations"].get("inserted", 0) == 0
    assert second.counts["facts"].get("inserted", 0) == 0
    assert second.counts["todos"].get("inserted", 0) == 0

    db.rollback()
    assert len(db.execute(select(Conversation)).scalars().all()) == 2
    assert len(db.execute(select(Fact)).scalars().all()) == 2
    assert len(db.execute(select(Todo)).scalars().all()) == 1


def test_sync_follows_pagination_cursors(run_sync, fake, db):
    # Fixture page size is 2, so five conversations require three pages.
    for index in range(5):
        fake.add_conversation(500 + index, f"Item {index}", start_offset=index * 1_000)

    result = run_sync(full=True)
    assert result.status == "success"
    assert result.counts["conversations"]["inserted"] == 5

    db.rollback()
    assert len(db.execute(select(Conversation)).scalars().all()) == 5

    cursors = [request.url.params.get("cursor") for request in fake.requests]
    assert "2" in cursors and "4" in cursors


def test_sync_records_failure_and_keeps_previous_cursor(run_sync, fake, db):
    fake.add_conversation(101, "Existing data")
    assert run_sync(full=True).status == "success"

    db.rollback()
    cursor_before = db.execute(select(SyncState)).scalar_one().cursor
    assert cursor_before
    # End the read transaction so the sync in another session can write.
    db.rollback()

    fake.fail_next("/v1/me", 401)
    failed = run_sync(full=False)

    assert failed.status == "failed"
    assert failed.error
    assert "credential" in failed.error.lower()

    db.rollback()
    assert db.execute(select(SyncState)).scalar_one().cursor == cursor_before
