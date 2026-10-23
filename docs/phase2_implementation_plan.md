# Phase 2 Implementation Plan — Bee Voice+

Date: 2026-10-23
Status: implemented; results in
[`phase2_implementation_report.md`](phase2_implementation_report.md). This file
is kept as the pre-implementation plan, with an addendum at the end for work
added during the verification pass.

## 1. Current architecture (Phase 1, inspected)

- **Backend:** one Flask app (`backend/app.py`) with Blueprints in
  `backend/routes/`. SQLAlchemy 2 models in `backend/models.py`; Alembic is the
  schema authority (`backend/migrations/versions/0001_initial.py`). SQLite is the
  local default, MySQL 8 is supported through `DATABASE_URL`.
- **Auth:** one operator account from `APP_USERNAME` / `APP_PASSWORD_HASH`;
  Flask signed-cookie sessions. Every data route is owner-scoped (`owner_id`).
- **Bee integration:** documented read paths are `/v1/conversations`,
  `/v1/daily`, `/v1/facts`, `/v1/todos`, `/v1/changes`, `/v1/search/*`,
  `/v1/stream`. The only documented write is completing a todo. Sync is
  idempotent on `(owner_id, bee_id)`.
- **Frontend:** React 18 + Vite + React Router 7. Pages live in
  `frontend/src/pages/`, shared UI in `components/`, auth/refresh context in
  `store.tsx`, tests in Vitest + React Testing Library.
- **Existing tables:** `users`, `conversations`, `daily_summaries`, `facts`,
  `todos`, `sync_state`, `sync_runs`.
- **Phase 1 tests:** 44 backend pytest tests and 54 frontend tests (13 files).

## 2. Phase 2 goals mapped to existing pieces

| Feature | Reuses | New pieces |
| --- | --- | --- |
| A. Voice assistant | `/api/assistant/chat`, browser SpeechRecognition/TTS | Voice page, AI client, optional server STT/TTS |
| B. Context chat | conversations, daily summaries, facts, todos, local search | context retrieval service, chat page |
| C. Personal memory | `facts` table and Memory page | source/origin fields, tombstones, extract/edit/delete |
| D. Smart tasks | `todos` table and Tasks page | local tasks, due dates, dedupe keys, extraction, reminders |
| E. Meeting assistant | conversation transcripts/summaries | `meetings` table, generation endpoint, Meetings page |
| F. Learning coach | conversation source text | `learning_sets` / `learning_items`, Learning page |
| G. Insights | all existing records | deterministic aggregation service, Insights page |
| H. Knowledge graph | existing records + source links | `knowledge_edges`, SVG graph page |
| I. Dashboard | existing Layout/App routes | new nav entries and routes only |

No duplicate app, dashboard, database, or auth system is created.

## 3. AI provider design

- **Server-only, OpenAI-compatible HTTP API** (no new SDK dependency):
  - `AI_PROVIDER=openai_compatible` (default) or `disabled`
  - `AI_BASE_URL` (default `https://api.openai.com/v1`)
  - `AI_API_KEY`, `AI_MODEL`, timeout, max output tokens, temperature
  - `AI_STT_MODEL` for `/audio/transcriptions`
  - `AI_TTS_MODEL` / `AI_TTS_VOICE` for `/audio/speech`
- An `AIClient` raises typed `AIError`s. Missing config → HTTP 503 with
  `ai_not_configured`; provider failures/timeouts → 502/504. No secret ever
  leaves the server.
- Tests inject an in-memory `FakeAI`; no test calls a real provider.
- If no provider is configured, deterministic features (insights, graph,
  memory/task CRUD, local search, manually entered learning content) still work.
  AI-dependent actions fail visibly with setup instructions.

## 4. Speech, audio, and wake word

- **Push-to-talk is the primary interaction.**
- Browser `SpeechRecognition` is used when available; otherwise `MediaRecorder`
  uploads to `/api/assistant/transcribe` (requires server STT).
- Browser `speechSynthesis` is used for playback by default; optional server TTS
  via `/api/assistant/speak`. Play/pause/resume/stop/mute are implemented.
- Audio is routed by the OS/browser to the current output device (phone,
  Bluetooth, speakers). The app does not select hardware directly.
- **Wake word:** no local wake-word engine is bundled, and continuous microphone
  audio is deliberately **not** sent to a cloud service just to detect a phrase.
  The UI stores a configurable phrase and reports the engine as unavailable until
  a local engine (for example a native companion or an on-device model) is
  installed. This is documented rather than faked.
- Background/tab-suspended detection is a documented browser limitation.

## 5. Context retrieval and grounding

- Keyword retrieval across owner-scoped conversations, daily summaries, facts,
  todos, meetings, and learning sets. SQL `ILIKE`/`LIKE` is portable across
  SQLite and MySQL; ranking happens in Python by term overlap and recency.
- The chat prompt receives only retrieved records and must answer from them or
  ask for clarification. Source cards include kind, id, timestamp, snippet, and
  an app route.
- No context → deterministic clarification response, no provider call.
- Embeddings/semantic search are **not** enabled because no embedding model /
  vector store is configured. The storage layer is ready for a future
  `pgvector`/MySQL-vector or external vector DB addition; this is documented.

## 6. Database changes (migration `0002_phase2`)

Additive only; existing rows are preserved:

- `facts`: `origin`, `source_kind`, `source_conversation_id`,
  `source_excerpt`, `ai_generated`, `created_at`, `updated_at`, `deleted_at`.
- `todos`: `origin`, `source_conversation_id`, `source_excerpt`, `due_at`,
  `postponed_until`, `ai_generated`, `dedupe_key`, `approved`, `created_at`,
  `updated_at`, `deleted_at`.
- New: `sync_tombstones`, `meetings`, `learning_sets`, `learning_items`,
  `knowledge_edges`.
- Local (user/AI) memories and tasks use negative `bee_id` values so the
  existing `(owner_id, bee_id)` uniqueness contract is preserved without a
  destructive key change.
- Deleted Bee-sourced memories/tasks create tombstones; sync skips them so they
  are not silently recreated.

## 7. API additions (application endpoints, not Bee endpoints)

- `GET /api/assistant/status`
- `POST /api/assistant/chat`
- `POST /api/assistant/transcribe`
- `POST /api/assistant/speak`
- `GET/POST /api/memories`, `PATCH/DELETE /api/memories/<id>`,
  `POST /api/memories/extract`
- `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/<id>`,
  `POST /api/tasks/extract`
- `GET/POST /api/meetings`, `GET/PATCH/DELETE /api/meetings/<id>`,
  `POST /api/meetings/<id>/generate`
- `GET/POST /api/learning`, `GET/PATCH/DELETE /api/learning/<id>`,
  `POST /api/learning/<id>/generate`, item CRUD
- `GET /api/insights?period=day|week`
- `GET /api/knowledge-graph`, `POST/DELETE /api/knowledge-graph/edges`
- `GET /api/search/local`

All are authenticated, owner-scoped, validated with Pydantic, and rate-limited
where they call an AI provider.

## 8. Security and reliability

- AI keys and Bee tokens remain server-side environment variables.
- Owner checks on every read/write; invalid ids return 404, never another user's
  data.
- In-memory sliding-window rate limiter on AI/transcription/speech endpoints
  (`AI_RATE_LIMIT_PER_MINUTE`, default 20/user/minute).
- Request body limits: Flask `MAX_CONTENT_LENGTH`; audio upload limit enforced in
  the route; text lengths validated.
- Provider timeouts/errors are surfaced without leaking payloads or secrets.
- No raw audio is stored; transcription is in-memory only.
- Migration is tested on a fresh SQLite database and against the existing one.

## 9. Frontend plan

- Extend `Layout` nav and `App` routes: AI chat, Voice assistant, Meetings,
  Learning coach, Insights, Knowledge graph. Phase 1 routes stay unchanged.
- New shared components: source cards, status chip, segmented controls already
  exist; add graph SVG, chat bubbles, audio controls.
- Extend Memory and Tasks pages with create/edit/approve/delete/extract and
  source/origin badges.
- Settings shows AI provider/STT/TTS/wake-word status without secrets.
- Accessibility: labelled controls, `aria-live` voice status, keyboard
  push-to-talk, visible stop/mute, focus states, responsive layouts.

## 10. Testing plan

Backend:
- Phase 1 regression suite (44 tests) must stay green.
- Fake AI tests for chat grounding, no-context clarification, provider failure,
  transcribe/speak, extraction, meeting/learning generation.
- Memory/task CRUD, tombstones, dedupe, ownership, invalid input, rate limits.
- Meeting source links, learning persistence, insight aggregation, graph edges.
- Alembic upgrade on fresh SQLite.

Frontend:
- Chat loading/empty/error/sources.
- Voice permission denial, unsupported APIs, push-to-talk, playback controls.
- Memory/task new actions; meetings/learning/insights/graph states.
- Existing 54 tests remain green.

Manual (documented, not automatable here): real microphone, browser STT/TTS
voices, OS audio routing/Bluetooth, Bee account/device sync, real AI provider.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Browser SpeechRecognition is vendor-dependent | Push-to-talk plus MediaRecorder/server-STT fallback; clear support state |
| Wake word would require continuous audio | Not enabled; documented local-engine requirement; no cloud wake-word streaming |
| AI provider absent | Deterministic features work; AI buttons return explicit 503; UI explains setup |
| Prompt hallucination | Only retrieved records in prompt; sources returned; no-context clarification; "AI-generated" labels |
| SQLite ALTER limitations | Additive columns + Alembic batch operations; no destructive changes |
| Negative local `bee_id` collision | Allocate below the current minimum; documented; unique constraint preserved |
| Duplicate tasks | Stable `dedupe_key` from source + normalized text; app-level conflict response |
| Tombstoned records re-appearing | Sync checks `sync_tombstones` before upserting facts/todos |
| Rate-limit memory growth | Sliding window prunes old timestamps; single-process dev deployment documented |

## 12. Bee limitations (verified in Phase 1 docs)

- Bee exposes conversations, transcripts, daily summaries, facts, todos, search,
  and SSE. It documents **no** speaker output, wake-word, custom voice-command,
  recording-control, contact, or calendar-write APIs.
- Phase 2 therefore never claims to control Bee hardware, record meetings, create
  external calendar events, or send notifications through an unconfigured
  service.
- Meeting/Learning/Insights features operate only on data already synced into the
  authorized local database.

## 13. Out of scope for this implementation

- A native mobile companion (needed for reliable background wake word).
- A bundled on-device wake-word model.
- Automatic embeddings/vector database (no provider/store configured).
- Server-push notifications (browser notifications are used only while the tab is
  open and permitted).
- Creating external calendar events or messaging third parties.

## 14. Addendum added during the verification pass

The plan above was implemented before this audit. The pass that produced the
report added:

- Migration `0003_learning_revision_plan` and an editable revision plan on
  learning sets.
- `source_conversation_bee_id` in memory/task responses, with source links and
  correct Bee-id routes in Insights commitments.
- `origin`/`ai_generated` acceptance on create, so accepted extraction
  candidates are stored as AI data rather than relabelled as user data.
- No-evidence handling for queries that tokenise to nothing (`???`).
- `GET /api/data/export`, Phase 2 privacy counts, and Phase 2-aware purge.
- Phase 2 counts on the overview and a working chat retry.
- 8 backend and 5 frontend regression tests for the above.

Final measured results: 85 backend tests, 72 frontend tests across 18 files,
TypeScript exit 0, production build exit 0, Alembic head
`0003_learning_revision_plan` on fresh SQLite.
