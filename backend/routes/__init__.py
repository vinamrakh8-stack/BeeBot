"""Flask blueprints for the dashboard API."""

from __future__ import annotations

from flask import Flask

from routes import (
    activity,
    assistant,
    auth,
    bee,
    conversations,
    insights,
    knowledge_graph,
    learning,
    local_search,
    meetings,
    memories,
    overview,
    search,
    settings,
    stream,
    summaries,
    tasks,
)


def register_blueprints(app: Flask) -> None:
    for module in (
        auth,
        overview,
        conversations,
        summaries,
        memories,
        tasks,
        search,
        local_search,
        activity,
        assistant,
        meetings,
        learning,
        insights,
        knowledge_graph,
        bee,
        settings,
        stream,
    ):
        app.register_blueprint(module.bp)
