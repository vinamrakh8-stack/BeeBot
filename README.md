# Bee Voice+ — Phase 3

A Flask + React dashboard over the **official Bee developer API**, extended with
a grounded AI assistant, voice interaction, personal memory and task management,
meetings, learning, insights, and a knowledge graph. Phase 3 adds a **phone
companion** with pairing, push-to-talk, optional on-device wake word, answer
playback, and data sync.

Phase 1 behaviour is preserved: the same app, dashboard, database, auth system,
and Bee sync. Phase 2 and 3 add features and tables; they do not replace them.

* Phase 3 capability matrix: [`docs/phase3_device_capability_matrix.md`](docs/phase3_device_capability_matrix.md)
* Phase 3 mobile guide: [`docs/phase3_mobile_companion.md`](docs/phase3_mobile_companion.md)
* Phase 3 report: [`docs/phase3_implementation_report.md`](docs/phase3_implementation_report.md)
* Phase 2 plan/report: [`docs/phase2_implementation_plan.md`](docs/phase2_implementation_plan.md),
  [`docs/phase2_implementation_report.md`](docs/phase2_implementation_report.md)
* Architecture: [`docs/architecture.md`](docs/architecture.md)
* Bee capability matrix: [`docs/bee_capability_matrix.md`](docs/bee_capability_matrix.md)

No Bee endpoint is invented, no connection is simulated, and no mock data ships
in production. Verified capabilities and limitations are stated in the UI and in
the capability matrices.

## What Phase 3 establishes

Bee's documented developer surface supports account/cloud data, sync, SSE, CLI,
MCP, and a preview Threads API. It does **not** document third-party software
installation on the device, firmware access, microphone/speaker/Bluetooth
control, a custom wake word, or device background execution. Phase 3 therefore
does not modify firmware or claim device control; it adds a phone companion that
uses the existing Voice+ server. The phone never receives the Bee or AI keys.

## Features

### Phase 1 (preserved)

* **Overview** — connection state, sync status, counts, recent activity.
* **Conversations** — paginated list, text filter, detail with transcript,
  location, links, and a visible "stale" note when Bee is unreachable.
* **Daily summaries** — date-ordered recaps with full/email/calendar sections.
* **Personal memory** — Bee facts with confirmation state and tags.
* **Tasks** — Bee tasks; completion is written to Bee first, then mirrored.
* **Search** — Bee keyword (BM25) and semantic modes, with the searched scope
  stated in the UI.
* **Activity** — merged timeline from synced records.
* **Settings** — Bee connection, sync history, privacy summary, local deletion.

### Phase 2 (added)

* **AI chat** — answers only from owner-scoped retrieved records, with `[S#]`
  citations. No evidence returns a clarification and never calls the provider.
* **Voice assistant** — push-to-talk, browser speech recognition with a
  MediaRecorder + server-STT fallback, browser TTS or server TTS, and
  play/pause/resume/stop/mute. Wake word is reported unavailable (see limits).
* **Personal memory** — local create/edit/delete, tags, confirmation, AI
  extraction candidates, source excerpts and source-conversation links.
* **Smart tasks** — local tasks with due dates, postponing, AI extraction,
  duplicate detection, provenance badges, source links, and opt-in foreground
  browser reminders.
* **Meetings** — create from an authorized conversation or manually; generate
  summaries, key points, decisions, and action items from stored source text.
* **Learning coach** — notes, goals, revision plan, AI flashcards/quizzes,
  manual cards, and review/mastered progress. Regeneration preserves manual cards.
* **Insights** — deterministic day/week counts and trends, decisions and
  commitments. No productivity/health scores and no AI.
* **Knowledge graph** — derived nodes/edges plus user-confirmed stored edges.
* **Data controls** — JSON export of every local record, Phase 2-aware privacy
  counts, and full local deletion.

### Phase 3 (added)

* **Phone companion** — Expo/React Native app in [`mobile/`](mobile) with a
  pairing flow, operator-scoped bearer token, secure OS storage, and visible
  connection state.
* **Push-to-talk questions** — short phone recording → server transcription →
  grounded answer with sources → phone TTS on the current OS audio route.
* **Optional on-device wake word** — disabled by default; phone-side OS speech
  recognition only, so wake audio never leaves the device. It is not Bee and not
  available in Expo Go.
* **Mobile data views** — conversations (with transcripts), tasks (including
  completion), daily summaries, overview counts, manual Bee sync, and the same
  owner scoping as the website.
* **Cancellation, timeout, retry, mute** — explicit states for disconnected,
  connected, idle, wake word heard, listening, processing, speaking, and error.
* **Device management** — website Settings lists paired phones and revokes them;
  the phone can revoke itself. Only a SHA-256 token hash is stored server-side.
* **Privacy controls** — local recording deleted after use, foreground-only
  operation, no background service, and server-local data deletion.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML5, CSS3, ES2022, React 18, React Router 7, Vite 6, TypeScript |
| Mobile companion | Expo SDK 58, React Native 0.88, React 19, TypeScript |
| Backend | Python 3.11+, Flask 3, Blueprints, SQLAlchemy 2, Alembic, Pydantic 2 |
| Database | SQLite (default local) or MySQL 8 via `DATABASE_URL` |
| Bee integration | `httpx` client for documented `/v1/*` endpoints |
| AI integration | Server-side OpenAI-compatible HTTP API (`httpx`, no SDK) |
| Mobile audio | `expo-audio` recording, `expo-speech` TTS, optional `expo-speech-recognition` |
| Testing | pytest, Vitest, React Testing Library, jsdom |

## Setup (Windows PowerShell)

Tested interpreter: Python 3.14.3 (the checked-in `venv`); the requirements use
version ranges so Python 3.11+ works. Node 24.19.0 and npm 12.2.1 were used.

```powershell
# 1. From the repository root
py -3 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r .\backend\requirements.txt
```

```powershell
# 2. Environment
Copy-Item .env.example .env
# Edit .env:
#   SECRET_KEY        -> python -c "import secrets; print(secrets.token_urlsafe(48))"
#   DATABASE_URL      -> sqlite:///./bee_voice.db (default) or your MySQL 8 URL
#   APP_PASSWORD_HASH -> generated below
#   BEE_TOKEN         -> from Bee CLI, or use BEE_API_MODE=proxy
#   AI_API_KEY        -> optional; AI features stay disabled without it
```

```powershell
# 3. Operator password hash
cd .\backend
python app.py hash-password
# paste the printed bcrypt hash into APP_PASSWORD_HASH
```

```powershell
# 4. Database schema (Alembic is authoritative)
cd .\backend
alembic upgrade head
# head is 0004_mobile_tokens
```

```powershell
# 5. Bee credentials (choose one)
npm install -g @beeai/cli
bee login
bee status

# EITHER copy the token into .env -> BEE_TOKEN=...
# OR run the documented local proxy and set BEE_API_MODE=proxy:
bee proxy            # serves 127.0.0.1:8787, local only
```

```powershell
# 6. Build and run the whole app from the repository root
cd .\frontend
npm install
npm run build

cd ..
python app.py        # http://127.0.0.1:5000
```

For frontend development with hot reload, run Vite separately (it proxies `/api`
to Flask on port 5000):

```powershell
cd .\frontend
npm run dev          # http://localhost:5173
```

### Mobile companion

```powershell
cd .\mobile
npm install
npm run typecheck
npm test

# Core app in Expo Go (wake word unavailable there):
npx expo start

# Native development build, required for the optional wake-word module:
npx expo run:android      # or: npx expo run:ios (macOS)
```

Pair with the server URL (`http://10.0.2.2:5000` from an Android emulator, the
computer's LAN address from a physical phone, or a deployed HTTPS URL), the
operator username/password, and a device name. Full instructions, permissions,
and the manual device protocol are in
[`docs/phase3_mobile_companion.md`](docs/phase3_mobile_companion.md).

Other commands:

```powershell
python app.py init-db        # create tables without Alembic (development only)
python app.py sync           # incremental sync (cron / Task Scheduler)
python app.py sync --full    # full re-sync
flask --app app sync         # same, through the Flask CLI
```

## AI and voice configuration

All AI configuration is server-side; the browser and phone receive status only.
API keys and Bee credentials never leave the server.

```dotenv
AI_PROVIDER=openai_compatible
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=gpt-4o-mini
AI_STT_MODEL=whisper-1
AI_TTS_MODEL=tts-1
AI_TTS_VOICE=alloy
AI_RATE_LIMIT_PER_MINUTE=20
AI_MAX_CONTEXT_SOURCES=8
AI_MAX_AUDIO_BYTES=10485760
WAKE_WORD_PHRASE=Hey Bee
WAKE_WORD_ENGINE=disabled
MOBILE_TOKEN_TTL_DAYS=90
MOBILE_PAIR_RATE_LIMIT_PER_MINUTE=5
```

* Without `AI_API_KEY` (or with `AI_PROVIDER=disabled`), AI actions return HTTP
  `503 ai_not_configured` and explain setup. Deterministic features still work.
* A local OpenAI-compatible server can be used by setting `AI_BASE_URL` to
  `http://127.0.0.1:11434/v1` and leaving the key empty.
* On the website, speech recognition and synthesis use browser APIs first. Server
  STT/TTS are fallbacks and require the corresponding models. The phone always
  uses the server for question transcription and phone TTS for playback.
* Wake word on the **website** is disabled: no local engine is bundled, and the
  app does not stream continuous microphone audio to a cloud service to detect a
  phrase. Push-to-talk is the reliable web interaction.
* The **phone** offers an optional wake word when the OS reports on-device speech
  recognition. It is foreground-only, disabled by default, and never sends wake
  audio to Voice+. It requires a native development build, not Expo Go.

## First run checklist

1. Sign in with `APP_USERNAME` and the password you hashed. In development the
   sign-in page may also show a demo account (`DEMO_PASSWORD`); it is never
   exposed when `APP_ENV=production`.
2. Open **Settings**: `configured` and `reachable` must both be green, and the
   connected account must be yours.
3. Press **Sync now** and inspect the per-entity counts and any error.
4. Open **AI chat** and check the provider badge. Without a key, the setup
   instructions are shown; nothing is faked.
5. Try **Voice assistant**: allow microphone access, use push-to-talk, and
   confirm transcription, answer, and playback.
6. Accept one memory/task candidate and confirm the `AI-suggested` badge and
   source-conversation link.
7. Export your data and inspect the JSON; then try the local-deletion flow on a
   test database.
8. Pair the phone companion against a test server and confirm it appears in
   Settings → Mobile companion. Exercise push-to-talk, cancel, mute, retry, and
   revoke.
9. On supported hardware, enable the optional local wake word and confirm that
   leaving the foreground stops it. See the manual device checklist in the Phase 3
   guide.

## App API and Bee endpoints

Bee endpoints used (unchanged from Phase 1):

| App route | Bee endpoint |
| --- | --- |
| `GET /api/bee/status` | `GET /v1/me` |
| `POST /api/bee/sync` | `/v1/conversations`, `/v1/daily`, `/v1/facts`, `/v1/todos`, `/v1/changes` |
| `GET /api/conversations[/id]` | `GET /v1/conversations[/id]` |
| `GET /api/summaries[/id]` | `GET /v1/daily[/id]` |
| `GET /api/memories` | `GET /v1/facts` |
| `GET /api/tasks` | `GET /v1/todos` |
| `PATCH /api/tasks/id` (completion) | `PUT /v1/todos/id` |
| `GET /api/search` | `POST /v1/search/conversations[/neural]` |
| `GET /api/stream` | `GET /v1/stream` (SSE proxy) |

Application endpoints added in Phase 2 (not Bee endpoints):

* Assistant: `GET /api/assistant/status`, `POST /api/assistant/chat`,
  `POST /api/assistant/transcribe`, `POST /api/assistant/speak`.
* Memory/task local CRUD and extraction: `/api/memories`, `/api/tasks`.
* Meetings: `/api/meetings`, `/api/meetings/<id>`, `/api/meetings/<id>/generate`.
* Learning: `/api/learning`, items, and `/api/learning/<id>/generate`.
* Insights: `GET /api/insights?period=day|week`.
* Knowledge graph: `/api/knowledge-graph`, `/api/knowledge-graph/edges`.
* Local search: `GET /api/search/local`.
* Data controls: `GET /api/data/export`, `GET /api/settings/privacy`,
  `DELETE /api/data`.

Application endpoints added in Phase 3 (not Bee endpoints):

* Pairing: `POST /api/mobile/pair` (operator credentials → opaque token).
* Session: `GET /api/mobile/session`, `DELETE /api/mobile/session`.
* Device management: `GET /api/mobile/devices`, `DELETE /api/mobile/devices/<id>`.
* The phone then uses the existing authenticated routes for overview,
  conversations, tasks, summaries, assistant chat/transcription, sync, and data
  deletion.

Except for pairing itself, these endpoints are authenticated and owner-scoped.
Pairing verifies the operator password, is rate-limited, and returns the raw token
only once. Mobile endpoints use `Authorization: Bearer …` after pairing.

## Tests

```powershell
cd .\backend
..\venv\Scripts\python.exe -m pytest -o addopts="" -q

cd ..\frontend
npm test -- --run
npm run typecheck
npm run build

cd ..\mobile
npm run typecheck
npm test
```

Measured on Windows on 2026-10-23 with Python 3.14.3, Node 24.19.0, npm 12.2.1:

| Check | Result |
| --- | --- |
| Backend pytest | **97 passed** in 135.49 s |
| Frontend Vitest | **74 passed**, 18 files, 25.84 s |
| Frontend typecheck | exit 0, no diagnostics |
| Frontend build | exit 0, 300.30 kB JS (88.67 kB gzip) |
| Mobile Vitest | **28 passed**, 4 files (<1 s) |
| Mobile typecheck | exit 0, no diagnostics |
| Mobile JS bundle | `npx expo export --platform android` and `--platform ios` | exit 0; 648/650 modules; ~1.7 MB Hermes bundle each |
| Expo config / doctor | config exit 0; microphone/Internet permissions only; `expo-doctor` 20/20 |
| `alembic upgrade head` on fresh SQLite | exit 0, head `0004_mobile_tokens`, 13 app tables + `alembic_version` |

Backend coverage includes auth/session security, owner scoping, CSRF, bearer
mobile pairing/revocation, rate limiting, Bee error mapping, retries, idempotent
full/incremental sync, tombstones, local memory/task/meeting/learning/insight/
graph behaviour, AI-origin provenance, source-id mapping, export/purge, and
migrations.

Frontend coverage includes the auth-gated router, every page's
loading/empty/error/retry states, Bee task write-through, AI chat and retry,
voice fallbacks and denied/unsupported APIs, accepted-candidate provenance,
source links, revision plans, data export, stale-cache fallback, failed-sync
reporting, paired-phone revocation, and the phone-list failure state.

Mobile coverage includes the eight-state companion machine, capture/transcribe/
chat/speak orchestration, local recording discard, playback timeout, quick-release
handling, cancel/timeout/retry/mute, bearer auth, GET-only retries, 401 handling,
and wake-phrase matching.

`FakeBee` and `FakeAI` are in-memory test doubles used **only** under
`backend/tests/`; mobile tests use adapter fakes under `mobile/tests/`. No test
calls the real Bee API, a real AI provider, or a real phone.

### Automated vs manual

**Automated here:** API/CRUD/generation logic, auth, ownership, mobile token
pairing/revocation, migrations on SQLite, React interaction with a mocked `fetch`,
and mobile voice/state/API behavior with fake adapters.

**Manual only:** a real Bee account/device, a real AI provider, a physical phone,
microphone and speaker permission/playback, OS/Bluetooth audio routing and
interruptions, the optional on-device wake word, a native mobile build,
battery/performance, and MySQL 8. See the Phase 3 report and manual checklist.

## Verification status

* Phase 1 features and tests remain green (see the report's regression section).
* No live Bee account/device was available in this environment, so live sync,
  transcripts, SSE and Bee rate limits were not verified.
* No real AI provider was available, so provider latency/quality and live error
  shapes were not verified.
* No physical phone, native build, microphone, Bluetooth route, or on-device
  speech model was available, so the companion was not hardware-validated and no
  battery/performance measurement is claimed.
* MySQL 8 was not available; Alembic was applied to SQLite only.
* The app never displays a connection or a successful sync it did not observe.

## Security notes

* Bee and AI credentials stay in server environment variables (or the local
  proxy) and are never sent to the browser or stored in the database.
* Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
* State-changing `/api/*` requests require a same-origin `Origin`/`Referer` for
  cookie sessions. Explicit Bearer requests bypass the cookie CSRF guard.
* Paired phones receive an opaque token; only its SHA-256 hash is stored in
  `mobile_tokens`. The raw token is kept in iOS Keychain/Android Keystore.
* Mobile tokens expire (`MOBILE_TOKEN_TTL_DAYS`) and are revocable from the phone
  or website. There is no silent refresh or cookie fallback.
* Pairing is rate-limited per client address
  (`MOBILE_PAIR_RATE_LIMIT_PER_MINUTE`).
* Mobile audio is one short recording per request, deleted after use; there is no
  continuous cloud recording or background microphone service.
* Searches and lookups use parameterised SQLAlchemy queries.
* AI rate limiting and upload/text limits are enforced server-side.
* `BEE_ALLOW_MOCK=true` is rejected when `APP_ENV=production`.
* The development demo account is never exposed in production.
* `GET /api/data/export` is authenticated and owner-scoped; treat the downloaded
  JSON as sensitive personal data.
* `DELETE /api/data` removes only local records; Bee is untouched.

## Deployment

1. `pip install -r backend/requirements.txt` and `alembic upgrade head`.
2. `npm run build` in `frontend/`.
3. For the companion, build `mobile/` with a native development build or EAS and
   point it at the HTTPS server. Expo Go runs the core app but cannot test the
   optional wake-word module.
4. Run `python app.py` behind HTTPS with `APP_ENV=production`, a strong
   `SECRET_KEY`, `DEMO_LOGIN_ENABLED=false`, and `CORS_ORIGINS` set to the public
   origin.
5. Store `BEE_TOKEN` (and `AI_API_KEY` if used) in a secret manager, not the
   image.
6. Schedule `python app.py sync` at least daily so the 7-day cursor never ages
   out.
7. Run a single worker, or replace the in-process sync lock, AI limiter, and
   pairing limiter with shared infrastructure before scaling horizontally.

## Required Bee access and permissions

Bee's documented API has no granular OAuth scopes: a valid account token grants
access to that account's `/v1/*` data. This app keeps the token server-side,
reads only the entities it needs, and makes exactly one Bee write path — marking
a Bee todo complete via `PUT /v1/todos/:id`. Local memories, tasks, meetings,
learning sets, and graph edges are stored only in this app's database.

| Requirement | Why | Where it goes |
| --- | --- | --- |
| Bee iOS app with Developer Mode unlocked (tap Version 5×) | Bee requires this before `bee login` issues a token | Device (manual step) |
| `BEE_TOKEN` from `bee login` / `bee status` | Bearer auth to the public HTTPS endpoint | Server env / secret manager |
| **or** a running `bee proxy` + `BEE_API_MODE=proxy` | Local proxy that holds auth for you | Local machine only |
| Access to your own Bee account data | Conversations, daily summaries, facts, todos | Bee account |
| `APP_USERNAME` + `APP_PASSWORD_HASH` | Dashboard operator login (separate from Bee) | Server env |
| `SECRET_KEY` | Flask session signing | Server env |
| `DATABASE_URL` | SQLite (local) or MySQL 8 (deploy) | Server env |
| `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL` | Optional AI chat/extraction/meeting/learning | Server env |
| `AI_STT_MODEL`, `AI_TTS_MODEL`, `AI_TTS_VOICE` | Optional server speech fallbacks | Server env |
| `CORS_ORIGINS` | Only when the React dev server is on another origin | Server env |
| `MOBILE_TOKEN_TTL_DAYS` | Lifetime of a paired-phone token (default 90) | Server env |
| `MOBILE_PAIR_RATE_LIMIT_PER_MINUTE` | Pairing attempts per client address (default 5) | Server env |
| Phone microphone + optional speech recognition | Push-to-talk and local wake word only | Phone OS permission |

## Known limitations

* **Live Bee not validated here** — sync, transcripts, SSE and rate limits need a
  real account and device.
* **Live AI not validated here** — prompts and errors were exercised with a fake
  client only.
* **Website wake word disabled** — no local engine is bundled; continuous cloud
  audio is intentionally not used. Push-to-talk is the supported web flow.
* **Phone wake word is conditional** — it needs an OS on-device recognizer, an
  Android offline model on 13+, foreground use, and a native development build.
  It is not available in Expo Go.
* **Phone app is foreground-only** — no background sync, push notifications, or
  background listening. The Talk screen polls while visible.
* **No Bee device control** — Bee documents no firmware, speaker, microphone,
  Bluetooth, wake-word, background-app, or device-command API. The phone uses its
  own hardware and never claims Bee playback.
* **Keyword retrieval only** — embeddings/vector search require a provider/store
  that is not configured.
* **Foreground reminders only** — browser notifications fire while the dashboard
  tab is open and permission is granted; there is no push service.
* **MySQL untested here** — migrations use batch mode but were applied to SQLite
  only in this environment.
* **Single-process assumptions** — sync lock, AI limiter, and mobile pairing
  limiter are in-process.
* **Token expiry, not rotation** — a phone re-pairs after its token expires.
* **Expo tooling advisory** — `npm audit --omit=dev` reports 4 high advisories in
  Expo CLI's transitive `node-forge`/code-signing toolchain; the suggested fix is
  a breaking Expo 44 downgrade, so it was not applied. Re-check for an Expo update.
* **Export is plain JSON** — protected by the operator session, not encrypted or
  password-protected.
* **Threads** are test-user-only (`403 test_user_required`) and are not built.
* **No people/contacts page** — Bee exposes no such endpoint.
