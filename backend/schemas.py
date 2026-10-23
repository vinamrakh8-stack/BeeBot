"""Serialisation models.

Timestamps are stored as naive UTC and emitted with an explicit ``Z`` so the
browser does not reinterpret them as local time.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, PlainSerializer


def _iso_z(value: datetime) -> str:
    return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


Utc = Annotated[datetime, PlainSerializer(_iso_z, return_type=str)]
Day = Annotated[date, PlainSerializer(lambda value: value.isoformat(), return_type=str)]


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(ApiModel):
    id: int
    username: str
    display_name: str | None = None


class ConversationOut(ApiModel):
    id: int | None = None
    bee_id: int
    uuid: str | None = None
    start_time: Utc | None = None
    end_time: Utc | None = None
    device_type: str | None = None
    state: str
    short_summary: str | None = None
    summary: str | None = None
    synced_at: Utc


class ConversationDetailOut(ConversationOut):
    primary_location: dict[str, Any] | None = None
    suggested_links: list[Any] | None = None
    transcriptions: list[Any] | None = None
    stale: bool = False


class DailySummaryOut(ApiModel):
    bee_id: int
    day: Day | None = None
    day_time: Utc | None = None
    short_summary: str | None = None
    summary: str | None = None
    email_summary: str | None = None
    calendar_summary: str | None = None
    conversations_count: int | None = None
    locations: list[Any] | None = None
    synced_at: Utc


class FactOut(ApiModel):
    bee_id: int
    text: str
    tags: list[str] | None = None
    confirmed: bool
    origin: str = "bee"
    source_kind: str | None = None
    source_conversation_id: int | None = None
    source_conversation_bee_id: int | None = None
    source_excerpt: str | None = None
    ai_generated: bool = False
    created_at: Utc | None = None
    updated_at: Utc | None = None
    deleted_at: Utc | None = None
    bee_created_at: Utc | None = None
    synced_at: Utc


class TodoOut(ApiModel):
    bee_id: int
    text: str
    completed: bool
    alarm_at: Utc | None = None
    origin: str = "bee"
    source_conversation_id: int | None = None
    source_conversation_bee_id: int | None = None
    source_excerpt: str | None = None
    due_at: Utc | None = None
    postponed_until: Utc | None = None
    ai_generated: bool = False
    approved: bool = True
    created_at: Utc | None = None
    updated_at: Utc | None = None
    deleted_at: Utc | None = None
    bee_created_at: Utc | None = None
    synced_at: Utc


class ContextSourceOut(BaseModel):
    kind: str
    ref: str
    id: int
    title: str
    snippet: str
    occurred_at: Utc | None = None
    route: str
    verified: bool = True
    score: float = 0.0
    metadata: dict[str, Any] = {}


class ChatOut(BaseModel):
    answer: str
    sources: list[ContextSourceOut]
    grounded: bool
    clarification_needed: bool = False
    model: str | None = None
    generated_at: Utc


class TranscriptOut(BaseModel):
    text: str
    model: str


class MeetingOut(ApiModel):
    id: int
    conversation_id: int | None = None
    conversation_bee_id: int | None = None
    title: str
    meeting_at: Utc | None = None
    participants: list[Any] | None = None
    summary: str | None = None
    key_points: list[Any] | None = None
    decisions: list[Any] | None = None
    action_items: list[Any] | None = None
    source_kind: str
    ai_generated: bool
    created_at: Utc
    updated_at: Utc


class LearningItemOut(ApiModel):
    id: int
    set_id: int
    kind: str
    question: str
    answer: str
    explanation: str | None = None
    status: str
    reviews: int
    last_reviewed_at: Utc | None = None
    ai_generated: bool
    created_at: Utc
    updated_at: Utc


class LearningSetOut(ApiModel):
    id: int
    title: str
    source_kind: str
    conversation_id: int | None = None
    conversation_bee_id: int | None = None
    notes: str | None = None
    goals: list[Any] | None = None
    revision_plan: list[Any] | None = None
    ai_generated: bool = False
    created_at: Utc
    updated_at: Utc
    item_count: int = 0


class LearningDetailOut(LearningSetOut):
    items: list[LearningItemOut] = []


class GraphNodeOut(BaseModel):
    id: str
    type: str
    label: str
    route: str
    verified: bool = True
    source: str | None = None
    metadata: dict[str, Any] = {}


class GraphEdgeOut(BaseModel):
    id: str
    source: str
    target: str
    relation: str
    derived: bool = True
    confidence: float = 1.0
    source_ref: str | None = None
    label: str | None = None


class GraphOut(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
    generated_at: Utc
    note: str = ""


class InsightsOut(BaseModel):
    period: str
    start: Utc
    end: Utc
    sufficient_data: bool
    counts: dict[str, int]
    recent_summaries: list[Any]
    conversations: list[Any]
    tasks: dict[str, list[Any]]
    decisions: list[Any]
    commitments: list[Any]
    project_activity: list[Any]
    trends: list[Any]
    notes: str
    generated_at: Utc


class SyncRunOut(ApiModel):
    id: int
    trigger: str
    status: str
    mode: str
    started_at: Utc
    finished_at: Utc | None = None
    counts: dict[str, Any] | None = None
    error: str | None = None


class SyncStatusOut(BaseModel):
    last_synced_at: Utc | None = None
    last_full_sync_at: Utc | None = None
    cursor_present: bool = False
    running: bool = False
    last_run: SyncRunOut | None = None


class ActivityItem(BaseModel):
    kind: str
    bee_id: int
    title: str
    subtitle: str | None = None
    occurred_at: Utc | None = None


class OverviewOut(BaseModel):
    counts: dict[str, int]
    sync: SyncStatusOut
    today_summary: DailySummaryOut | None = None
    recent_conversations: list[ConversationOut]
    open_todos: list[TodoOut]
    recent_facts: list[FactOut]
    recent_activity: list[ActivityItem]
