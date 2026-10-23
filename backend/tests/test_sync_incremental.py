from __future__ import annotations

from sqlalchemy import select

from models import Conversation, Fact, SyncState


def test_incremental_sync_fetches_only_changed_ids(run_sync, fake, db):
    fake.add_conversation(101, "First topic", start_offset=1_000)
    assert run_sync(full=True).status == "success"

    fake.add_conversation(103, "Second topic", start_offset=3_000)
    fake.changes_payload["conversations"] = [103]

    result = run_sync(full=False)
    assert result.status == "success"
    assert result.mode == "incremental"
    assert result.counts["conversations"]["inserted"] == 1

    db.rollback()
    ids = {row.bee_id for row in db.execute(select(Conversation)).scalars().all()}
    assert ids == {101, 103}


def test_expired_cursor_degrades_to_full_sync(run_sync, fake, db):
    fake.add_conversation(101, "First topic")
    assert run_sync(full=True).status == "success"

    db.rollback()
    state = db.execute(select(SyncState)).scalar_one()
    state.cursor = "old-cursor"
    db.commit()

    fake.add_conversation(104, "After the cursor window", start_offset=4_000)
    result = run_sync(full=False)

    assert result.status == "success"
    assert result.mode == "full"
    assert result.counts["sync"]["cursor_expired"] == 1

    db.rollback()
    ids = {row.bee_id for row in db.execute(select(Conversation)).scalars().all()}
    assert 104 in ids


def test_incremental_deletion_removes_local_fact(run_sync, fake, db):
    fake.add_fact(301, "Temporary fact")
    assert run_sync(full=True).status == "success"

    fake.facts.pop(301)
    fake.changes_payload["facts"] = [301]

    result = run_sync(full=False)
    assert result.status == "success"
    assert result.counts["facts"]["deleted"] == 1

    db.rollback()
    assert db.execute(select(Fact)).scalars().all() == []


def test_rate_limit_is_retried(run_sync, fake, monkeypatch):
    monkeypatch.setattr("services.bee_client.time.sleep", lambda *args, **kwargs: None)
    fake.add_conversation(101, "Retry me")
    fake.fail_next("/v1/me", 429, times=1)

    result = run_sync(full=True)
    assert result.status == "success"
    assert result.counts["conversations"]["inserted"] == 1
