# Architecture

## Overview

```
Browser (React 18 + TypeScript, Vite)
   │  fetch("/api/…")  same-origin, HttpOnly session cookie
   ▼
Flask app (backend/app.py)
   ├── routes/            blueprints: auth, bee, conversations, summaries,
   │                      memories, tasks, search, activity, settings, stream,
   │                      overview, assistant, meetings, learning, insights,
   │                      knowledge_graph, local_search
   ├── services/
   │     bee_client.py     HTTP transport, retries, typed errors
   │     bee_service.py    connection status, account redaction, search
   │     sync_service.py   full/incremental sync, status, purge
   │     normalize.py      wire payload → column values
   │     activity_service.py  merged timeline
   │     ai_client.py      server-only OpenAI-compatible chat/STT/TTS
   │     context_service.py  owner-scoped keyword retrieval + prompt block
   │     source_service.py   source text, conversation id/bee-id mapping
   │     memory_service.py   local ids, tombstones, memory extraction
   │     task_service.py     task extraction, dedupe keys
   │     meeting_service.py  meeting generation
   │     learning_service.py learning notes/cards/revision plan generation
   │     insight_service.py  deterministic day/week aggregation
   │     graph_service.py    derived + stored knowledge graph
   │     rate_limit.py       in-process AI sliding window
   ├── models.py          SQLAlchemy models
   ├── schemas.py         Pydantic response models
   ├── security.py        session auth, CSRF guard, operator bootstrap
   └── migrations/        Alembic (head 0003_learning_revision_plan)
   ▼
SQLite (default) / MySQL 8 (optional, via DATABASE_URL)
   ▲                         ▲
   │ httpx                   │ server-side HTTP only
Bee developer API            OpenAI-compatible AI provider (optional)
https://api.developer.bee.amazon.dev/v1/*
   or local `bee proxy` http://127.0.0.1:8787/v1/*
```

The AI provider is **not** Bee. Bee has no documented chat-completion, speech
synthesis, wake-word, or device-command API. All assistant behaviour is this
application's own, grounded in records already synced for the signed-in operator.

## Single entry point

`backend/app.py` is both the application factory and the runner:

* `python app.py` — from the repository root or `backend/` — starts Flask, which
  serves `/api/*` **and** the built React app from `frontend/dist` (with an SPA
  fallback for client-side routes). The root file is a thin launcher that puts
  `backend/` on the import path.
* `python app.py init-db`, `hash-password`, `sync` are operator commands.
* `flask --app app run` and `flask --app app init-db` also work because Flask
  discovers the `create_app` factory.

In development you can instead run Vite on `:5173`; it proxies `/api` to Flask on
`:5000`, so cookies and SSE stay same-origin.

## Request lifecycle

1. `enforce_same_origin` (`before_request`) blocks cross-origin mutations on
   `/api/*` when an `Origin`/`Referer` is present and not allowed.
2. `login_required` reads `session["uid"]`, loads the operator, and returns
   `401 {"error":"not_authenticated"}` when absent.
3. The route opens one SQLAlchemy session per request (closed by
   `teardown_appcontext`). Every data query filters on `owner_id`.
4. Bee calls go through `BeeClient`; AI calls go through `AIClient`. Both map
   upstream failures to typed errors that are serialised without secrets.
5. Responses are Pydantic models dumped with UTC timestamps (`…Z`).
6. AI-backed routes call a per-operator sliding-window rate limiter before the
   provider request.

## Sync design

| Concern | Approach |
| --- | --- |
| Full sync | Cursor-paginated `GET /v1/conversations`, `/v1/daily`, `/v1/facts` (confirmed + pending), `/v1/todos` |
| Incremental sync | `GET /v1/changes?cursor=…`, then re-fetch only changed ids |
| Cursor lifetime | Bee rejects cursors older than 7 days (`cursor_too_old`); the run degrades to a full sync |
| Idempotency | `UNIQUE (owner_id, bee_id)` + get-then-upsert; replaying a page cannot duplicate rows |
| Deletions | `404` on a changed id → soft delete (conversations, summaries) or hard delete (facts, tasks) |
| Local deletions | Tombstones in `sync_tombstones` stop Bee-sourced facts/todos from being recreated |
| Failure | Partial upserts are kept (safe to replay); the run is marked `failed`; the cursor does **not** advance |
| Concurrency | In-process lock → a second concurrent sync gets `409` |
| Real time | `/api/stream` proxies Bee SSE; the UI debounces refetches. No polling loop |

Phase 2 records (meetings, learning sets/items, graph edges) are **local** and are
not part of Bee sync. They reference Bee data only through stored ids.

## Retrieval and grounding

`services/context_service.py` performs owner-scoped SQL keyword retrieval across
conversations, daily summaries, memories, tasks, meetings, and learning sets:

1. Tokenise and drop stop words (maximum 8 terms).
2. A non-empty query with no searchable terms returns **no results**.
3. Filter with portable `ILIKE`/`LIKE`, then rank in Python by term frequency and
   recency.
4. Return typed `ContextSource` records with kind, id, title, snippet, timestamp,
   route, verification flag, and score.

`/api/assistant/chat` puts only those records in the prompt. With no sources it
returns a deterministic clarification message and never calls the provider.
Embeddings are not enabled: no embedding provider or vector store is configured.
The interface is intentionally narrow so a future vector store can replace the
retrieval step without changing the chat contract.

## AI and speech

* `AI_PROVIDER=openai_compatible` uses server-side `AI_BASE_URL` / `AI_API_KEY` /
  `AI_MODEL`; `AI_PROVIDER=disabled` or a missing key makes AI actions return
  `503 ai_not_configured`.
* `AIClient` supports chat text, strict-JSON chat, audio transcription, and speech
  synthesis. Timeouts and HTTP failures become `502`/`504`-style typed errors.
* The browser uses `SpeechRecognition` when available; otherwise `MediaRecorder`
  uploads audio to `/api/assistant/transcribe` (server STT required).
* Playback uses browser `speechSynthesis` by default, or `/api/assistant/speak`
  when server TTS is configured.
* Raw audio is not stored. Only the resulting text is returned to the caller.
* Wake word is disabled: no local engine is bundled and continuous cloud audio is
  deliberately not used for detection.

## Database

| Table | Purpose |
| --- | --- |
| `users` | Dashboard operator (bcrypt hash) |
| `sync_state` | Incremental cursor, last successful/full sync |
| `sync_runs` | Audit trail: trigger, mode, status, counts, error |
| `sync_tombstones` | Local deletions sync must not recreate |
| `conversations` | Metadata + summaries; transcript JSON filled on demand |
| `daily_summaries` | Recaps, email/calendar summaries, locations |
| `facts` | Bee facts and local user/AI memories; provenance, source, confirmation |
| `todos` | Bee tasks and local user/AI tasks; provenance, due date, dedupe key |
| `meetings` | Meeting summaries derived from conversations or entered manually |
| `learning_sets` | Notes, goals, revision plan, source conversation, AI flag |
| `learning_items` | Flashcards/quizzes with review status and counts |
| `knowledge_edges` | User-confirmed graph relationships; derived edges are computed |

Local memories and tasks use negative `bee_id` values so the existing
`(owner_id, bee_id)` uniqueness contract is preserved. All data tables carry
`owner_id`. Migrations live in `backend/migrations/` and are managed with
Alembic (`alembic upgrade head`); `0003_learning_revision_plan` is additive.

## Privacy, export, and deletion

* Bee and AI credentials are server-only and never serialised to the browser.
* `GET /api/settings/privacy` counts Phase 1 **and** Phase 2 local records and
  lists every category that is stored.
* `GET /api/data/export` returns an authenticated, owner-scoped JSON export of
  conversations, summaries, memories, tasks, meetings, learning sets/items, and
  graph edges. It is labelled as a download and is not cached.
* `GET /api/bee/status` returns a redacted profile (primitive fields only; keys
  named token/secret/password are dropped).
* Session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production.
* CSRF: same-origin enforcement on state-changing `/api/*` requests.
* Parameterised SQLAlchemy queries only; no string-built SQL.
* `DELETE /api/data` removes every local record owned by the operator, including
  Phase 2 tables and tombstones. Bee is never modified.

## Frontend

* Routes: Overview, Conversations, Conversation detail, Daily summaries,
  Personal memory, Tasks, Search, Activity, Settings, AI chat, Voice assistant,
  Meetings, Meeting detail, Learning, Learning detail, Insights, Knowledge graph.
* Shared components: `Layout` (nav, sync button, live indicator), `Card`,
  `Badge`, `StatCard`, `Pagination`, `ActivityFeed`, `SourceList`,
  loading/empty/error states.
* `store.tsx` holds auth state, a refresh token, and the SSE subscription.
* Retrieval mode, AI-configured state, wake-word availability, origin badges,
  `AI-generated` labels, and source links are shown explicitly so generated or
  assistant-produced content is never mistaken for Bee data.
* Accessibility: skip link, labelled forms, `aria-pressed`/`aria-expanded`,
  `aria-live` chat/voice status, visible focus rings, reduced-motion support.
* Responsive: CSS grid shell; the sidebar becomes an off-canvas drawer under
  900px; tables scroll horizontally.

## Deliberate boundaries

* Bee is never controlled: no device recording, speaker output, wake-word, or
  hardware command is claimed.
* No live meeting recording. Meetings are generated only from an authorized
  stored conversation or entered manually.
* No people/contacts page: Bee exposes no such endpoint.
* No threads UI: test-user-only endpoint.
* No embeddings/vector search: no provider or store is configured.
* No background push notifications: reminders are foreground browser
  notifications only.
* No external calendar writes or third-party messaging.
