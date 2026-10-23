"""Synchronisation engine and sync state helpers.

All endpoints used here are documented:

* Full sync pages ``/v1/conversations``, ``/v1/daily``, ``/v1/facts`` and
  ``/v1/todos`` via ``next_cursor``.
* Incremental sync uses ``/v1/changes?cursor=...`` and re-fetches changed ids.
* Bee rejects cursors older than **7 days** (``cursor_too_old``); that degrades
  to a full sync automatically.

Idempotency: ``UNIQUE (owner_id, bee_id)`` plus a get-then-upsert write path.
The cursor advances only on a successful run.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from config import Settings
from models import (
    Conversation,
    DailySummary,
    Fact,
    KnowledgeEdge,
    LearningItem,
    LearningSet,
    Meeting,
    SyncRun,
    SyncState,
    SyncTombstone,
    Todo,
    utcnow,
)
from schemas import SyncRunOut, SyncStatusOut
from services.bee_client import BeeClient
from services.bee_errors import BeeCursorTooOld, BeeError, BeeNotFound
from services.normalize import (
    conversation_values,
    daily_values,
    fact_values,
    id_list,
    todo_values,
)


@dataclass
class SyncResult:
    run_id: int
    status: str
    mode: str
    counts: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "mode": self.mode,
            "counts": self.counts,
            "error": self.error,
        }


class SyncBusy(Exception):
    """Raised when another sync holds the lock."""


class SyncService:
    def __init__(self, session: Session, client: BeeClient, settings: Settings, owner_id: int) -> None:
        self.session = session
        self.client = client
        self.settings = settings
        self.owner_id = owner_id
        self.counts: dict[str, dict[str, int]] = {}
        self._max_items = settings.bee_sync_page_size * settings.bee_sync_max_pages

    # ------------------------------------------------------------------ helpers

    def _bump(self, entity: str, outcome: str) -> None:
        bucket = self.counts.setdefault(entity, {})
        bucket[outcome] = bucket.get(outcome, 0) + 1

    def _get_state(self) -> SyncState:
        state = self.session.execute(
            select(SyncState).where(SyncState.owner_id == self.owner_id)
        ).scalar_one_or_none()
        if state is None:
            state = SyncState(owner_id=self.owner_id)
            self.session.add(state)
            self.session.flush()
        return state

    def _upsert(self, model, bee_id: int, values: dict, *, entity: str):
        existing = self.session.execute(
            select(model).where(model.owner_id == self.owner_id, model.bee_id == bee_id)
        ).scalar_one_or_none()

        now = utcnow()
        if existing is None:
            row = model(owner_id=self.owner_id, bee_id=bee_id, synced_at=now, **values)
            self.session.add(row)
            # Flush so a duplicate id later in the same run updates this row.
            self.session.flush()
            self._bump(entity, "inserted")
            return row

        changed = False
        for key, value in values.items():
            if getattr(existing, key) != value:
                setattr(existing, key, value)
                changed = True
        existing.synced_at = now
        if getattr(existing, "deleted", False):
            existing.deleted = False
            changed = True
        self._bump(entity, "updated" if changed else "unchanged")
        return existing

    def _soft_delete(self, model, bee_id: int, entity: str) -> None:
        row = self.session.execute(
            select(model).where(model.owner_id == self.owner_id, model.bee_id == bee_id)
        ).scalar_one_or_none()
        if row is not None and not row.deleted:
            row.deleted = True
            self._bump(entity, "deleted")

    def _hard_delete(self, model, bee_id: int, entity: str) -> None:
        row = self.session.execute(
            select(model).where(model.owner_id == self.owner_id, model.bee_id == bee_id)
        ).scalar_one_or_none()
        if row is not None:
            self.session.delete(row)
            self._bump(entity, "deleted")

    def _is_tombstoned(self, entity: str, bee_id: int) -> bool:
        return (
            self.session.execute(
                select(SyncTombstone.id).where(
                    SyncTombstone.owner_id == self.owner_id,
                    SyncTombstone.entity == entity,
                    SyncTombstone.source_id == bee_id,
                )
            ).first()
            is not None
        )

    def _tombstoned(self, entity: str) -> None:
        self._bump(entity, "tombstoned")

    # --------------------------------------------------------------- full passes

    def _full_conversations(self) -> None:
        paged = self.client.paginate(
            "/v1/conversations", "conversations", page_size=self.settings.bee_sync_page_size
        )
        for raw in paged.items:
            bee_id = raw.get("id")
            if isinstance(bee_id, int):
                self._upsert(Conversation, bee_id, conversation_values(raw), entity="conversations")
        if paged.truncated:
            self.counts.setdefault("conversations", {})["truncated"] = 1

    def _full_daily(self) -> None:
        paged = self.client.paginate(
            "/v1/daily", "daily_summaries", page_size=self.settings.bee_sync_page_size
        )
        for raw in paged.items:
            bee_id = raw.get("id")
            if isinstance(bee_id, int):
                self._upsert(DailySummary, bee_id, daily_values(raw), entity="daily")
        if paged.truncated:
            self.counts.setdefault("daily", {})["truncated"] = 1

    def _full_facts(self) -> None:
        # The API filters by `confirmed`, so both states need a pass.
        for confirmed in ("true", "false"):
            paged = self.client.paginate(
                "/v1/facts",
                "facts",
                page_size=self.settings.bee_sync_page_size,
                extra={"confirmed": confirmed},
            )
            for raw in paged.items:
                bee_id = raw.get("id")
                if isinstance(bee_id, int) and isinstance(raw.get("text"), str):
                    if self._is_tombstoned("fact", bee_id):
                        self._tombstoned("facts")
                        continue
                    self._upsert(Fact, bee_id, fact_values(raw), entity="facts")
            if paged.truncated:
                self.counts.setdefault("facts", {})["truncated"] = 1

    def _full_todos(self) -> None:
        paged = self.client.paginate(
            "/v1/todos", "todos", page_size=self.settings.bee_sync_page_size
        )
        for raw in paged.items:
            bee_id = raw.get("id")
            if isinstance(bee_id, int) and isinstance(raw.get("text"), str):
                if self._is_tombstoned("todo", bee_id):
                    self._tombstoned("todos")
                    continue
                self._upsert(Todo, bee_id, todo_values(raw), entity="todos")
        if paged.truncated:
            self.counts.setdefault("todos", {})["truncated"] = 1

    def _full_sync(self) -> None:
        self._full_conversations()
        self._full_daily()
        self._full_facts()
        self._full_todos()

    # ---------------------------------------------------------- incremental pass

    def _incremental_sync(self, cursor: str | None) -> str | None:
        payload = self.client.changes(cursor)
        next_cursor = payload.get("next_cursor")
        next_cursor = next_cursor if isinstance(next_cursor, str) and next_cursor else None

        conversation_ids = id_list(payload, "conversations")[: self._max_items]
        daily_ids = id_list(payload, "dailies")[: self._max_items]
        fact_ids = id_list(payload, "facts")[: self._max_items]
        todo_ids = id_list(payload, "todos")[: self._max_items]

        for bee_id in conversation_ids:
            try:
                raw = self.client.conversation(bee_id)
            except BeeNotFound:
                self._soft_delete(Conversation, bee_id, "conversations")
                continue
            if raw:
                self._upsert(Conversation, bee_id, conversation_values(raw), entity="conversations")

        for bee_id in daily_ids:
            try:
                raw = self.client.daily_summary(bee_id)
            except BeeNotFound:
                self._soft_delete(DailySummary, bee_id, "daily")
                continue
            if raw:
                self._upsert(DailySummary, bee_id, daily_values(raw), entity="daily")

        for bee_id in fact_ids:
            if self._is_tombstoned("fact", bee_id):
                self._tombstoned("facts")
                continue
            try:
                raw = self.client.fact(bee_id)
            except BeeNotFound:
                self._hard_delete(Fact, bee_id, "facts")
                continue
            if raw and isinstance(raw.get("text"), str):
                self._upsert(Fact, bee_id, fact_values(raw), entity="facts")

        for bee_id in todo_ids:
            if self._is_tombstoned("todo", bee_id):
                self._tombstoned("todos")
                continue
            try:
                raw = self.client.todo(bee_id)
            except BeeNotFound:
                self._hard_delete(Todo, bee_id, "todos")
                continue
            if raw and isinstance(raw.get("text"), str):
                self._upsert(Todo, bee_id, todo_values(raw), entity="todos")

        return next_cursor

    # --------------------------------------------------------------------- entry

    def run(self, *, trigger: str = "manual", full: bool = False) -> SyncResult:
        state = self._get_state()
        mode = "full" if (full or state.last_synced_at is None or not state.cursor) else "incremental"

        run = SyncRun(
            owner_id=self.owner_id, trigger=trigger, status="running", mode=mode, started_at=utcnow()
        )
        self.session.add(run)
        self.session.flush()

        try:
            # Verifies credentials/connectivity before touching data.
            self.client.me()

            if mode == "incremental":
                try:
                    next_cursor = self._incremental_sync(state.cursor)
                except BeeCursorTooOld:
                    mode = "full"
                    run.mode = "full"
                    self.counts.setdefault("sync", {})["cursor_expired"] = 1
                else:
                    state.cursor = next_cursor or state.cursor
                    state.last_synced_at = utcnow()
                    self._finish(run, "success", None)
                    return self._result(run)

            # Capture a fresh cursor before the full pass so the next incremental
            # run has a valid starting point even for a large account.
            try:
                next_cursor = self.client.changes(None).get("next_cursor")
            except BeeError:
                next_cursor = None

            self._full_sync()

            if isinstance(next_cursor, str) and next_cursor:
                state.cursor = next_cursor
            state.last_synced_at = utcnow()
            state.last_full_sync_at = utcnow()
            self._finish(run, "success", None)
            return self._result(run)

        except BeeError as exc:
            # Partial upserts are kept (replaying them is safe); the cursor is
            # never advanced and the failure is recorded.
            self._finish(run, "failed", exc.message)
            return self._result(run)
        except Exception as exc:  # defensive: keep the audit row
            self._finish(run, "failed", f"{type(exc).__name__}: {exc}")
            return self._result(run)

    def _finish(self, run: SyncRun, status: str, error: str | None) -> None:
        run.status = status
        run.finished_at = utcnow()
        run.counts = self.counts
        run.error = error
        self.session.commit()

    def _result(self, run: SyncRun) -> SyncResult:
        return SyncResult(
            run_id=run.id or 0,
            status=run.status,
            mode=run.mode,
            counts=run.counts or {},
            error=run.error,
        )


# ------------------------------------------------------------------ orchestration


def is_running(lock) -> bool:
    return bool(lock.locked())


def get_sync_status(db: Session, owner_id: int, *, running: bool = False) -> SyncStatusOut:
    state = db.execute(select(SyncState).where(SyncState.owner_id == owner_id)).scalar_one_or_none()
    last_run = db.execute(
        select(SyncRun).where(SyncRun.owner_id == owner_id).order_by(SyncRun.id.desc()).limit(1)
    ).scalar_one_or_none()

    return SyncStatusOut(
        last_synced_at=state.last_synced_at if state else None,
        last_full_sync_at=state.last_full_sync_at if state else None,
        cursor_present=bool(state and state.cursor),
        running=running,
        last_run=SyncRunOut.model_validate(last_run) if last_run else None,
    )


def run_sync(
    db: Session,
    client: BeeClient,
    settings: Settings,
    owner_id: int,
    *,
    trigger: str,
    full: bool,
    lock,
) -> SyncResult:
    if not lock.acquire(blocking=False):
        raise SyncBusy("A sync is already in progress.")
    try:
        return SyncService(db, client, settings, owner_id).run(trigger=trigger, full=full)
    finally:
        lock.release()


def purge_synced_data(db: Session, owner_id: int) -> dict[str, int]:
    """Delete this operator's local data only. Bee itself is never modified.

    Phase 2 records (meetings, learning sets/items, confirmed graph edges) are
    included so "delete local data" means everything this app stored, not just
    the Phase 1 mirror. Tombstones are removed with it: a later sync may then
    recreate Bee-owned rows, which is the behaviour the UI documents.
    """
    deleted: dict[str, int] = {}

    # Children before parents; SQLite and MySQL both accept the subquery form.
    owner_sets = select(LearningSet.id).where(LearningSet.owner_id == owner_id)
    learning_items = db.execute(
        delete(LearningItem).where(LearningItem.set_id.in_(owner_sets))
    )
    deleted["learning_items"] = int(learning_items.rowcount or 0)

    for name, model in (
        ("knowledge_edges", KnowledgeEdge),
        ("learning_sets", LearningSet),
        ("meetings", Meeting),
        ("conversations", Conversation),
        ("daily_summaries", DailySummary),
        ("memories", Fact),
        ("tasks", Todo),
    ):
        result = db.execute(delete(model).where(model.owner_id == owner_id))
        deleted[name] = int(result.rowcount or 0)

    deleted["sync_runs"] = int(
        db.execute(delete(SyncRun).where(SyncRun.owner_id == owner_id)).rowcount or 0
    )
    db.execute(delete(SyncState).where(SyncState.owner_id == owner_id))
    deleted["tombstones"] = int(
        db.execute(
            delete(SyncTombstone).where(SyncTombstone.owner_id == owner_id)
        ).rowcount
        or 0
    )
    db.commit()
    return deleted
