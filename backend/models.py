"""SQLAlchemy models.

Bee entity ids live in `bee_id` beside our surrogate key. The unique constraint
on (owner_id, bee_id) is what makes sync idempotent. Bee timestamps arrive as
epoch milliseconds and are stored as naive UTC datetimes.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class SyncState(Base):
    __tablename__ = "sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    cursor: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_full_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    counts: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("owner_id", "bee_id", name="uq_conversations_owner_bee"),
        Index("ix_conversations_owner_start", "owner_id", "start_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    bee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    uuid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    device_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    short_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    primary_location: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    suggested_links: Mapped[list | None] = mapped_column(JSON, nullable=True)
    transcriptions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bee_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bee_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class DailySummary(Base):
    __tablename__ = "daily_summaries"
    __table_args__ = (
        UniqueConstraint("owner_id", "bee_id", name="uq_daily_owner_bee"),
        Index("ix_daily_owner_date", "owner_id", "day"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    bee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    day: Mapped[date | None] = mapped_column(Date, nullable=True)
    day_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    short_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    email_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    calendar_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    conversations_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    locations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bee_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bee_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class Fact(Base):
    """A personal-memory entry Bee learned about the user."""

    __tablename__ = "facts"
    __table_args__ = (
        UniqueConstraint("owner_id", "bee_id", name="uq_facts_owner_bee"),
        Index("ix_facts_owner_created", "owner_id", "bee_created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    bee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Phase 2 provenance. `bee` rows come from sync; `user`/`ai` rows use a
    # negative bee_id so the existing uniqueness contract is preserved.
    origin: Mapped[str] = mapped_column(String(16), default="bee", nullable=False)
    source_kind: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bee_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class Todo(Base):
    __tablename__ = "todos"
    __table_args__ = (
        UniqueConstraint("owner_id", "bee_id", name="uq_todos_owner_bee"),
        Index("ix_todos_owner_completed", "owner_id", "completed"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    bee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    alarm_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Phase 2 task provenance and scheduling.
    origin: Mapped[str] = mapped_column(String(16), default="bee", nullable=False)
    source_conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    postponed_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bee_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class SyncTombstone(Base):
    """Local deletions that sync must not recreate.

    Used for Bee-sourced facts and todos. ``entity`` is ``fact`` or ``todo`` and
    ``source_id`` is the Bee id.
    """

    __tablename__ = "sync_tombstones"
    __table_args__ = (
        UniqueConstraint("owner_id", "entity", "source_id", name="uq_tombstone_owner_entity_source"),
        Index("ix_tombstones_owner_entity", "owner_id", "entity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    entity: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class Meeting(Base):
    """A meeting summary derived from an authorized conversation or entered locally."""

    __tablename__ = "meetings"
    __table_args__ = (
        Index("ix_meetings_owner_date", "owner_id", "meeting_at"),
        Index("ix_meetings_owner_conversation", "owner_id", "conversation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conversation_bee_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    meeting_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    participants: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_points: Mapped[list | None] = mapped_column(JSON, nullable=True)
    decisions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    action_items: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source_kind: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LearningSet(Base):
    """User-approved learning workspace built from a conversation or manually."""

    __tablename__ = "learning_sets"
    __table_args__ = (
        Index("ix_learning_sets_owner_created", "owner_id", "created_at"),
        Index("ix_learning_sets_owner_conversation", "owner_id", "conversation_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conversation_bee_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    goals: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Ordered, plain-language study schedule. Stored as JSON strings so the plan
    # can be edited in the UI without a second table.
    revision_plan: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LearningItem(Base):
    __tablename__ = "learning_items"
    __table_args__ = (Index("ix_learning_items_set", "set_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    set_id: Mapped[int] = mapped_column(
        ForeignKey("learning_sets.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), default="flashcard", nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="new", nullable=False)
    reviews: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class KnowledgeEdge(Base):
    """User-confirmed graph relationship. Derived edges are computed, not stored."""

    __tablename__ = "knowledge_edges"
    __table_args__ = (
        UniqueConstraint(
            "owner_id",
            "from_type",
            "from_ref",
            "to_type",
            "to_ref",
            "relation",
            name="uq_knowledge_edge",
        ),
        Index("ix_knowledge_edges_owner", "owner_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    from_type: Mapped[str] = mapped_column(String(32), nullable=False)
    from_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    to_type: Mapped[str] = mapped_column(String(32), nullable=False)
    to_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    relation: Mapped[str] = mapped_column(String(64), default="related_to", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class MobileToken(Base):
    """A paired phone's bearer credential.

    Only a SHA-256 hash of the token is stored. The raw value is returned once
    at pairing and kept in the phone's Keychain/Keystore through SecureStore.
    Revocation is a soft delete so an audit trail remains without retaining a
    usable credential.
    """

    __tablename__ = "mobile_tokens"
    __table_args__ = (
        Index("ix_mobile_tokens_owner", "owner_id"),
        Index("ix_mobile_tokens_expiry", "expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    device_name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

