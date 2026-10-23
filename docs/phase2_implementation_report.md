# Phase 2 Implementation Report — Bee Voice+

> Historical snapshot: these counts, migration head, and table count describe
> Phase 2 only. Phase 3 adds `0004_mobile_tokens`; see
> [`phase3_implementation_report.md`](phase3_implementation_report.md) for current
> results.

Date: 2026-10-23
Status: implemented and verified locally
Scope: audit and completion pass over the existing Phase 2 codebase

## 1. Summary

Phase 2 was already present in the repository when this pass began. This pass
audited it end to end, fixed the gaps found, added regression tests for them, and
re-ran every available check. No Phase 1 feature, route, table, or page was
removed, and no second app, dashboard, database, or auth system was created.

The main corrections in this pass:

1. **Correct conversation links.** Memories and tasks store a local
   `source_conversation_id`, but conversation routes use Bee ids. They now emit
   `source_conversation_bee_id`, and Insights commitments link with the Bee id
   instead of a local id that could open the wrong conversation.
2. **Honest AI provenance.** Saving an accepted extraction candidate now persists
   `origin="ai"` and `ai_generated=true`; client-supplied rows can only be `user`
   or `ai`, and cannot claim to be Bee data.
3. **No evidence from noise.** A chat or local-search query made only of
   punctuation/stop words (for example `???`) now returns no sources and asks for
   clarification instead of returning unrelated recent records.
4. **Learning revision plans.** Generated and manually edited study plans are now
   stored on the learning set (migration `0003`) and editable in the UI.
5. **Complete privacy controls.** `GET /api/data/export` downloads every local
   record as JSON, privacy counts include Phase 2 tables, and "delete local data"
   now covers meetings, learning sets/items, graph edges, tombstones, and sync
   metadata.
6. **Dashboard + retry correctness.** Overview shows Phase 2 counts; AI chat
   retry resends the failed question instead of the cleared input box.

## 2. Feature checklist

| Planned feature | Status | Notes |
| --- | --- | --- |
| A. Voice assistant | Implemented | Push-to-talk, browser `SpeechRecognition` with MediaRecorder/STT fallback, browser TTS with optional server TTS, play/pause/resume/stop/mute. Wake word is reported unavailable because no local engine is bundled. |
| B. Grounded context chat | Implemented | Owner-scoped keyword retrieval over conversations, summaries, memories, tasks, meetings, learning sets. Answers cite `[S#]` sources; no evidence → deterministic clarification with no provider call. |
| C. Personal memory | Implemented | Bee facts plus local user/AI memories, tags, confirmation state, source excerpt + source link, extraction candidates, dedupe, tombstones. |
| D. Smart tasks | Implemented | Bee write-through completion preserved; local tasks with due date, postponing, AI extraction, duplicate detection, provenance, source links, opt-in foreground reminders. |
| E. Meeting assistant | Implemented | Meetings from authorized conversations or manual entry; AI summary generation only from stored source text. |
| F. Learning coach | Implemented | Notes, goals, revision plan, AI flashcards/quiz from a conversation, manual cards, review/mastered progress. Regeneration replaces only AI items. |
| G. Insights | Implemented | Deterministic day/week counts and trends from stored records. No productivity/health scores and no AI. |
| H. Knowledge graph | Implemented | Derived nodes/edges from existing records plus user-confirmed stored edges. |
| I. Unified dashboard | Implemented | Phase 1 pages unchanged; Phase 2 pages added to the existing shell and navigation. |
| Data export | Implemented | `GET /api/data/export` (JSON, authenticated, owner-scoped). |
| Privacy/deletion | Completed | Phase 2 tables counted and purged with the rest of the local data. |

## 3. API surface added or corrected in this pass

Application endpoints (not Bee endpoints):

- `GET /api/data/export` — full local JSON export with `Content-Disposition`.
- `PATCH /api/learning/<id>` now accepts `revision_plan`.
- `POST /api/learning/<id>/generate` persists a generated `revision_plan`.
- `POST /api/memories` and `POST /api/tasks` accept `origin` (`user`/`ai`) and
  `ai_generated`; `origin="bee"` is rejected.
- `GET /api/memories` and `GET /api/tasks` include `source_conversation_bee_id`.
- `GET /api/overview` counts `meetings` and `learning_sets`.
- `GET /api/settings/privacy` counts meetings, learning sets/items and graph
  edges.
- `DELETE /api/data` purges all Phase 2 local data in addition to the Phase 1
  mirror.

All existing Phase 2 endpoints from `docs/phase2_implementation_plan.md`
(`/api/assistant/*`, meetings, learning, insights, graph, local search) remain
available and unchanged in shape except for the additive fields above.

### 3.1 Files changed in this pass

Backend:

- `api_utils.py` — `provenance()` helper and dict-capable `page_payload`.
- `models.py`, `schemas.py` — `LearningSet.revision_plan` and input validation.
- `routes/tasks.py`, `routes/memories.py` — provenance persistence and
  `source_conversation_bee_id`.
- `routes/overview.py` — meeting and learning-set counts.
- `routes/settings.py` — `GET /api/data/export`, Phase 2 privacy counts/purge.
- `routes/learning.py` — revision-plan persistence on patch/generate.
- `services/source_service.py` — batched conversation-id mapping.
- `services/context_service.py`, `services/insight_service.py`,
  `services/learning_service.py`, `services/sync_service.py` — evidence guard,
  Bee-id links, revision plan, Phase 2-aware purge.
- `migrations/versions/0003_learning_revision_plan.py` — additive migration.
- `tests/test_phase2_integrity.py` (new), `tests/test_migrations.py`.

Frontend:

- `src/types.ts`, `src/pages/AIChat.tsx`, `Tasks.tsx`, `Memory.tsx`,
  `LearningDetail.tsx`, `Settings.tsx`, `Overview.tsx`.
- `src/pages/AIChat.test.tsx`, `MemoryTasks.phase2.test.tsx`,
  `MeetingsLearning.test.tsx`, `Settings.test.tsx`.

Docs and configuration:

- `README.md`, `.env.example`.
- `docs/phase2_implementation_report.md` (new), `docs/architecture.md`,
  `docs/bee_capability_matrix.md`, `docs/phase2_implementation_plan.md`
  (addendum).

## 4. Database and migrations

Alembic remains the schema authority.

| Revision | Change | Data safety |
| --- | --- | --- |
| `0001_initial` | Phase 1 schema | Unchanged |
| `0002_phase2` | Provenance columns, local tasks/memories, tombstones, meetings, learning, graph | Existing Phase 2 migration; unchanged |
| `0003_learning_revision_plan` | Adds nullable JSON `learning_sets.revision_plan` | Additive only; existing learning sets keep all data and start with `NULL` |

Verified on a fresh SQLite database:

```text
alembic upgrade head
→ 0001_initial → 0002_phase2 → 0003_learning_revision_plan
→ version 0003_learning_revision_plan
→ 12 application tables + alembic_version
```

No table, column, or row was dropped or renamed. Local user/AI records keep the
existing negative `bee_id` convention, so the `(owner_id, bee_id)` uniqueness
contract is preserved.

## 5. Tests and actual results

Environment: Windows, Python 3.14.3 (checked-in `venv`), Node 24.19.0,
npm 12.2.1.

| Check | Command | Result |
| --- | --- | --- |
| Backend suite | `..\venv\Scripts\python.exe -m pytest -o addopts="" -q` in `backend/` | **85 passed** in 95.39 s |
| Frontend suite | `npm test -- --run` in `frontend/` | **72 passed**, 18 files, 3.81 s |
| TypeScript | `npm run typecheck` | exit 0, no diagnostics |
| Production build | `npm run build` | exit 0; `dist/` written (298.61 kB JS, 20.77 kB CSS before gzip) |
| Alembic upgrade | `alembic upgrade head` on fresh SQLite | exit 0, head `0003_learning_revision_plan` |
| Migration regression | `tests/test_migrations.py` | Passed: `0002` preserves existing rows; `0003` preserves learning sets and adds `revision_plan` |

New automated coverage in this pass (`backend/tests/test_phase2_integrity.py`,
plus four existing frontend test files):

- Source conversation Bee id is serialized and linked for tasks and memories.
- AI-origin memory/task persistence; rejecting `origin="bee"` and non-boolean
  `ai_generated`.
- Punctuation-only chat/search requests return no evidence and never call the AI
  provider.
- Revision plan create/patch/generate persistence and validation.
- Insight task commitments link to `/conversations/<bee_id>`.
- Export includes meetings, learning items and graph edges; privacy counts match;
  purge removes them; export after purge is empty.
- Owner scoping for meetings, learning, graph edges and export.
- Frontend: AI retry sends the original question exactly once; accepted
  candidates send `origin="ai"` and `source_bee_id`; source links render;
  revision plan is displayed and saved; export triggers a JSON download.

### Automated vs manual

Automated here: all API/CRUD/generation logic with `FakeBee` and `FakeAI`, auth,
ownership, migrations on SQLite, React rendering/interaction with mocked `fetch`.

Not automated here: a real Bee account/device, a real AI provider, a real
microphone/speaker, OS/Bluetooth audio routing, browser speech-recognition
engines, and MySQL 8.

## 6. Windows setup

```powershell
# From the repository root
py -3 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r .\backend\requirements.txt

Copy-Item .env.example .env
# Edit SECRET_KEY, APP_PASSWORD_HASH, DATABASE_URL, BEE_TOKEN (or BEE_API_MODE=proxy),
# and AI_API_KEY if AI features are wanted.

cd .\backend
python app.py hash-password          # paste the hash into APP_PASSWORD_HASH
alembic upgrade head                 # authoritative schema, includes 0003

cd ..\frontend
npm install
npm run build

cd ..
python app.py                        # http://127.0.0.1:5000
```

For hot reload, run `npm run dev` in `frontend/` (Vite proxies `/api` to Flask on
port 5000) while `python app.py` runs the API.

Verification commands:

```powershell
cd .\backend
..\venv\Scripts\python.exe -m pytest -o addopts="" -q

cd ..\frontend
npm test -- --run
npm run typecheck
npm run build
```

## 7. Environment variables

All values are documented in `.env.example`. No secret belongs in source or in
the database.

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `APP_ENV` | Development/production behaviour | `development` |
| `SECRET_KEY` | Flask session signing | Required in production |
| `DATABASE_URL` | SQLite or MySQL 8 | `sqlite:///./bee_voice.db` |
| `APP_USERNAME`, `APP_PASSWORD_HASH` | Dashboard operator login | Separate from Bee |
| `DEMO_LOGIN_ENABLED`, `DEMO_PASSWORD` | Development demo account | Never exposed when `APP_ENV=production` |
| `CORS_ORIGINS` | Cross-origin dev frontend | Only needed when origins differ |
| `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS` | Session cookie name/lifetime | `bee_session`, 7 days |
| `BEE_API_MODE`, `BEE_TOKEN` | Bee token mode | Token stays server-side |
| `BEE_API_BASE_URL` | Bee public API base URL | Override only for a compatible endpoint |
| `BEE_PROXY_URL` | Local `bee proxy` mode | `http://127.0.0.1:8787` |
| `BEE_TIMEOUT_SECONDS`, `BEE_MAX_RETRIES` | Bee transport behaviour | Client backs off and honours `Retry-After` |
| `BEE_SYNC_PAGE_SIZE`, `BEE_SYNC_MAX_PAGES` | Sync bounds | Sync at least daily (7-day cursor rule) |
| `BEE_ALLOW_MOCK` | Development fixtures | Rejected when `APP_ENV=production` |
| `AI_PROVIDER` | `openai_compatible` or `disabled` | Empty key means AI actions return 503 |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Chat provider | Key never reaches the browser |
| `AI_STT_MODEL`, `AI_TTS_MODEL`, `AI_TTS_VOICE` | Server speech fallbacks | Browser speech APIs are used first |
| `AI_TIMEOUT_SECONDS`, `AI_MAX_OUTPUT_TOKENS`, `AI_TEMPERATURE` | Provider request bounds | — |
| `AI_RATE_LIMIT_PER_MINUTE` | Per-operator AI limit | 20 |
| `AI_MAX_CONTEXT_SOURCES`, `AI_MAX_AUDIO_BYTES` | Retrieval/upload bounds | — |
| `WAKE_WORD_PHRASE`, `WAKE_WORD_ENGINE` | Displayed wake-word status | Engine is `disabled`; no local model bundled |
| `FLASK_HOST`, `FLASK_PORT`, `FRONTEND_DIST` | Server and static build | — |

## 8. External configuration required

| Service | Needed for | Status in this pass |
| --- | --- | --- |
| Bee account + Developer Mode + token (or local `bee proxy`) | Sync, conversations, transcripts, facts, todos, Bee task completion | Not available; tested only with `FakeBee` |
| OpenAI-compatible AI endpoint | Chat answers, extraction, meeting/learning generation, server STT/TTS | Not available; tested only with `FakeAI`. Deterministic pages work without it |
| MySQL 8 server | Deployment database alternative | Not available; migrations verified on SQLite only |
| Microphone/speaker + browser speech support | Voice assistant manual flows | Not automatable in this environment |
| HTTPS reverse proxy | Production cookies (`Secure`) and deployment | Deployment step, not exercised |

## 9. Known limitations (honest status)

1. **No live Bee validation.** No request was made to the real Bee API, so live
   account sync, plan/retention differences, and rate limits remain unverified.
2. **No real AI provider validation.** Prompt quality, latency, and provider
   error shapes were exercised only through the deterministic fake client.
3. **Wake word is disabled.** No local wake-word engine is bundled, and the app
   deliberately does not stream continuous audio to a cloud service to detect a
   phrase. Push-to-talk is the reliable web interaction.
4. **No semantic/embedding retrieval.** Retrieval is keyword-based over existing
   SQL tables. No embedding provider or vector store is configured.
5. **No Bee device control.** Bee documents no speaker, wake-word, recording, or
   device-command API. Voice output is the browser/server TTS of this app, not the
   Bee device.
6. **No background notifications.** Browser task reminders fire only while the
   dashboard tab is open and permission is granted.
7. **MySQL not run.** The migration uses batch mode for portability, but it has
   only been applied to SQLite in this environment.
8. **Single-process limits.** The sync lock and AI rate limiter are in-process;
   horizontal scaling needs a shared lock/limiter.
9. **Export is plain JSON.** It contains personal data and is protected by the
   operator session, but it is not encrypted at rest or password-protected.

## 10. Phase 1 regression report

- All pre-existing backend tests remained green. The suite grew from **77** to
  **85** with 8 added tests (7 integrity tests + 1 migration test); no Phase 1
  test was modified to make a new feature pass.
- All pre-existing frontend tests remained green. The suite grew from **67** to
  **72** across the same 18 files (5 added tests).
- TypeScript and the production build pass.
- Phase 1 routes, tables, auth, Bee sync, search, SSE, conversation/detail,
  daily summaries, activity and settings behaviour were not replaced.
- Phase 1 local data remains readable after `0003`: the migration only adds a
  nullable column.

## 11. Manual test checklist (not run here)

1. Sign in and confirm Settings shows `configured`/`reachable` with a real Bee
   token.
2. Run **Sync now** and verify per-entity counts and a real transcript.
3. Use **Voice assistant** with microphone permission granted: push-to-talk,
   transcription, answer, speak/stop/mute.
4. Deny microphone permission once and confirm the page explains the failure and
   offers the upload/text fallback.
5. Ask a question with no stored evidence and confirm the clarification message
   with no source cards.
6. Accept one memory and one task candidate; confirm the `AI-suggested` badge and
   the source-conversation link.
7. Generate a meeting summary and a learning set with a revision plan from a real
   conversation.
8. Export data, inspect the JSON, then delete local data and confirm all Phase 2
   counts return to zero.
9. Apply `alembic upgrade head` to a MySQL 8 database and repeat a CRUD smoke
   test.
