"""Translate documented Bee wire payloads into column values.

Field names come from the official API reference and the Bee CLI's parsers:
list envelopes are ``{<key>, next_cursor, timezone}``; facts are
``{id, text, tags[], created_at, confirmed}``; todos add
``completed``/``alarm_at``; conversation list items carry
``{id, start_time, end_time, created_at, summary, state}`` while detail adds
``uuid, device_type, short_summary, transcriptions[]``.

Only keys actually present are returned, so a list refresh cannot blank out a
transcript that a detail fetch already stored.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

_MISSING = object()


def ms_to_dt(value: Any) -> datetime | None:
    if value is None or value is _MISSING or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.isdigit():
            return ms_to_dt(int(raw))
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    return None


def as_str(value: Any, *, max_len: int | None = None) -> str | None:
    if value is None or value is _MISSING:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None
    return value[:max_len] if max_len else value


def as_int(value: Any) -> int | None:
    if value is None or value is _MISSING or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def parse_day(value: Any) -> date | None:
    if value is None or value is _MISSING:
        return None
    if isinstance(value, str):
        raw = value.strip()
        if raw[:10].count("-") == 2:
            try:
                return datetime.strptime(raw[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
    parsed = ms_to_dt(value)
    return parsed.date() if parsed else None


def _json_list(value: Any) -> list | None:
    return value if isinstance(value, list) else None


def _json_obj(value: Any) -> dict | None:
    return value if isinstance(value, dict) else None


def conversation_values(raw: dict) -> dict:
    values: dict[str, Any] = {}

    uuid = as_str(raw.get("uuid"), max_len=64)
    if uuid is not None:
        values["uuid"] = uuid
    if "start_time" in raw:
        values["start_time"] = ms_to_dt(raw.get("start_time"))
    if "end_time" in raw:
        values["end_time"] = ms_to_dt(raw.get("end_time"))

    device_type = as_str(raw.get("device_type"), max_len=64)
    if device_type is not None:
        values["device_type"] = device_type

    values["state"] = as_str(raw.get("state"), max_len=32) or "unknown"

    if "short_summary" in raw:
        values["short_summary"] = as_str(raw.get("short_summary"))
    if "summary" in raw:
        values["summary"] = as_str(raw.get("summary"))
    if "primary_location" in raw:
        values["primary_location"] = _json_obj(raw.get("primary_location"))
    if "suggested_links" in raw:
        values["suggested_links"] = _json_list(raw.get("suggested_links"))
    if "transcriptions" in raw:
        values["transcriptions"] = _json_list(raw.get("transcriptions"))
    if "created_at" in raw:
        values["bee_created_at"] = ms_to_dt(raw.get("created_at"))
    if "updated_at" in raw:
        values["bee_updated_at"] = ms_to_dt(raw.get("updated_at"))
    return values


def daily_values(raw: dict) -> dict:
    values: dict[str, Any] = {}

    day = parse_day(raw.get("date"))
    if day is not None:
        values["day"] = day
    if "date_time" in raw:
        values["day_time"] = ms_to_dt(raw.get("date_time"))
        if day is None and values["day_time"] is not None:
            values["day"] = values["day_time"].date()

    for key in ("short_summary", "summary", "email_summary", "calendar_summary"):
        if key in raw:
            values[key] = as_str(raw.get(key))
    if "conversations_count" in raw:
        values["conversations_count"] = as_int(raw.get("conversations_count"))
    if "locations" in raw:
        values["locations"] = _json_list(raw.get("locations"))
    if "created_at" in raw:
        values["bee_created_at"] = ms_to_dt(raw.get("created_at"))
    if "updated_at" in raw:
        values["bee_updated_at"] = ms_to_dt(raw.get("updated_at"))
    return values


def fact_values(raw: dict) -> dict:
    values: dict[str, Any] = {}
    text = as_str(raw.get("text"))
    if text is not None:
        values["text"] = text
    if "tags" in raw:
        values["tags"] = _json_list(raw.get("tags"))
    confirmed = as_bool(raw.get("confirmed"))
    if confirmed is not None:
        values["confirmed"] = confirmed
    if "created_at" in raw:
        values["bee_created_at"] = ms_to_dt(raw.get("created_at"))
    return values


def todo_values(raw: dict) -> dict:
    values: dict[str, Any] = {}
    text = as_str(raw.get("text"))
    if text is not None:
        values["text"] = text
    completed = as_bool(raw.get("completed"))
    if completed is not None:
        values["completed"] = completed
    if "alarm_at" in raw:
        # ISO 8601 on input, epoch milliseconds in responses.
        values["alarm_at"] = ms_to_dt(raw.get("alarm_at"))
    if "created_at" in raw:
        values["bee_created_at"] = ms_to_dt(raw.get("created_at"))
    return values


def id_list(payload: Any, *keys: str) -> list[int]:
    """Extract ids from a `/v1/changes` bucket (ids or objects with an id)."""
    if not isinstance(payload, dict):
        return []
    found: list[int] = []
    for key in keys:
        bucket = payload.get(key)
        if isinstance(bucket, dict):
            bucket = bucket.get("ids")
        if not isinstance(bucket, list):
            continue
        for item in bucket:
            if isinstance(item, dict):
                item = item.get("id")
            item_id = as_int(item)
            if item_id is not None:
                found.append(item_id)
    return list(dict.fromkeys(found))
