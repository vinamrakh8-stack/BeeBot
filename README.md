# Bee Voice+ — Phase 1

A Flask + React dashboard over the **official Bee developer API**. It signs in
with its own operator account, syncs real Bee data server-side, and shows
conversations, daily summaries, personal memories, tasks, search and activity.

No endpoints are invented, no connection is simulated, and no mock data ships in
production. Verified capabilities and limitations:
[`docs/bee_capability_matrix.md`](docs/bee_capability_matrix.md). Architecture:
[`docs/architecture.md`](docs/architecture.md).

## Build and verification history

The Phase 1 application was already present when this verification pass began.
This pass inspected it end to end, re-read the official Bee documentation,
added the missing Vitest + React Testing Library suite, added a
`/api/connection/status` alias, upgraded React Router to a patched release,
applied the Alembic migration to a fresh database, started the real Flask
server, and recorded the actual results below. The original author noted that
an unused `venv/` was the only pre-existing artefact.

## Features

* **Overview** — connection state, last successful sync, counts, recent activity.
* **Conversations** — paginated list, text filter, detail with transcript,
  location, links, and a visible "stale" note when Bee is unreachable.
* **Daily summaries** — date-ordered recaps with full/email/calendar sections.
* **Personal memory** — Bee facts with confirmation state and tags.
* **Tasks** — Bee tasks only; completion is written to Bee first, then mirrored.
* **Search** — Bee keyword (BM25) and semantic modes, with the searched scope
  stated in the UI.
* **Activity** — merged timeline from synced records.
* **Settings** — Bee connection, sync history, privacy summary, local data
  deletion.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | HTML5, CSS3, JavaScript (ES2022), React 18, React Router 7, Vite 6 |
| Backend | Python 3.11+, Flask 3, Blueprints, SQLAlchemy 2, Alembic |
| Database | SQLite (default local, zero setup) or MySQL 8 (recommended for deployment) via `DATABASE_URL` |
| Bee integration | `httpx` client for documented `/v1/*` endpoints |

## Setup (Windows PowerShell)

Tested interpreter target: Python 3.11–3.14 (the checked-in `venv/` is 3.14; the
requirements use version ranges so pip can pick wheels for it). Node 22.12+ for
the frontend toolchain (React Router 7 and Vitest 5 require it).

```powershell
# 1. From the repository root (the `web/` folder)
py -3 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r .\backend\requirements.txt
```

```powershell
# 2. Environment
Copy-Item .env.example .env
# Edit .env:
#   SECRET_KEY       -> python -c "import secrets; print(secrets.token_urlsafe(48))"
#   DATABASE_URL     -> sqlite:///./bee_voice.db (default), or your MySQL 8 URL
#   APP_PASSWORD_HASH-> generated below
#   DEMO_PASSWORD    -> optional development demo shown on the sign-in page
#   BEE_TOKEN        -> from Bee CLI (below)
```

```powershell
# 3. Operator password hash
cd .\backend
python app.py hash-password
# paste the printed bcrypt hash into APP_PASSWORD_HASH
```

```powershell
# 4. Database schema (Alembic is authoritative) — run inside .\backend
cd .\backend
alembic upgrade head
# quick local alternative with SQLite:
# python app.py init-db
```

```powershell
# 5. Bee credentials
npm install -g @beeai/cli
bee login
bee status

# EITHER copy the token into .env -> BEE_TOKEN=...
# (file fallback if the OS keychain is unavailable)
$env:BEE_FORCE_FILE_STORE = "1"
bee login
Get-Content "$env:USERPROFILE\.bee\token-prod"
```

Alternatively run the documented local proxy and set `BEE_API_MODE=proxy`:

```powershell
bee login
bee proxy            # serves 127.0.0.1:8787, unauthenticated, local only
```

```powershell
# 6. Run the whole app with one command (from the repository root)
python app.py        # http://127.0.0.1:5000
# equivalent: cd .\backend ; python app.py
```

`app.py` exists twice on purpose: `web/app.py` is the launcher you run from the
project folder (`web/`), and `backend/app.py` is the Flask app it loads. Both
take the same subcommands, and both serve the API and the built React bundle
from one process.

`app.py` serves the API **and** the built React app. Build the frontend first:

```powershell
cd .\frontend
npm install
npm run build
```

For frontend development with hot reload, run Vite separately (it proxies `/api`
to Flask on port 5000):

```powershell
cd .\frontend
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```powershell
python app.py init-db        # create tables without Alembic
python app.py sync           # incremental sync (cron / Task Scheduler)
python app.py sync --full    # full re-sync
flask --app app sync         # same, through the Flask CLI
```

## First run checklist

1. Sign in with `APP_USERNAME` and the password you hashed. In development the
   sign-in page also shows a **Demo account** box (`operator` /
   `DEMO_PASSWORD`, `123456` in `.env.example`); the **Use demo account** button
   fills the form. Set `DEMO_LOGIN_ENABLED=false` to hide it — it is never
   exposed when `APP_ENV=production`.
2. Open **Settings**: `configured` and `reachable` must both be green, and the
   connected account must be yours.
3. Press **Sync now** and check the run table for per-entity counts.
4. If anything fails, the exact Bee error is shown — nothing is hidden.

## Bee API routes used

| App route | Bee endpoint |
| --- | --- |
| `GET /api/bee/status` (alias `GET /api/connection/status`) | `GET /v1/me` |
| `POST /api/bee/sync` | `/v1/conversations`, `/v1/daily`, `/v1/facts`, `/v1/todos`, `/v1/changes` |
| `GET /api/conversations[/id]` | `GET /v1/conversations[/id]` |
| `GET /api/summaries[/id]` | `GET /v1/daily[/id]` |
| `GET /api/memories` | `GET /v1/facts` |
| `GET /api/tasks` | `GET /v1/todos` |
| `PATCH /api/tasks/id` | `PUT /v1/todos/id` |
| `GET /api/search` | `POST /v1/search/conversations[/neural]` |
| `GET /api/stream` | `GET /v1/stream` (SSE proxy) |
| `GET /api/settings/privacy`, `DELETE /api/data` | local data only |

## Tests

```powershell
cd .\backend
pytest
```

Coverage:

* `test_auth.py` — login, wrong password, unknown user, tampered cookie, logout,
  unconfigured operator.
* `test_sync.py` — full-sync persistence, idempotent re-runs, cursor pagination,
  failure keeps the previous cursor.
* `test_sync_incremental.py` — change-feed fetch, 7-day cursor fallback,
  deletion mirroring, 429 retry.
* `test_access_control.py` — owner scoping and cross-origin mutation blocking.
* `test_bee_client.py` — 401/403 (including `test_user_required` → capability
  error)/404/`cursor_too_old` mapping, retry exhaustion, pagination, search body.
* `test_api.py` — search passthrough, task write-through and failure, connection
  status, overview, privacy/deletion, health.

Bee is replaced by an in-memory HTTP transport in `tests/fake_bee.py` that
mirrors the documented shapes. It is used **only** by tests.

Frontend tests (Vitest + React Testing Library, jsdom):

```powershell
cd .\frontend
npm install
npm test               # 52 tests across 13 files
npm run typecheck
npm run build
npm run test:coverage  # optional: HTML report in coverage/
```

* `src/components/States.test.tsx` — loading/status, error alert + retry, empty state.
* `src/api.test.ts` — structured errors, nested `detail`, network failure, 204,
  401 broadcast, JSON request body.
* `src/App.test.tsx` — unauthenticated redirect, authenticated shell/nav,
  failed top-bar sync reporting.
* `src/pages/Tasks.test.tsx` — loading, empty, error + retry, write-through
  `PATCH`, failed write keeps the row unchanged.
* `src/pages/Overview.test.tsx` — loading, empty, connection error.
* `src/pages/Search.test.tsx` — loading, empty, upstream error, result links.
* `src/pages/Conversations.test.tsx` — loading, empty, list links, error + retry.
* `src/pages/ConversationDetail.test.tsx` — loading, error + back link,
  summary/location/links/transcript, stale-cache warning.
* `src/pages/Daily.test.tsx` — loading, empty, error + retry, expandable recap.
* `src/pages/Memory.test.tsx` — loading, empty, error + retry, tags.
* `src/pages/Activity.test.tsx` — loading, empty, error + retry, timeline links.
* `src/pages/Settings.test.tsx` — loading, verified connection/account, failed
  sync is reported and never shown as success.
* `src/pages/Login.test.tsx` — disabled submit, server authentication error,
  development demo box + fill, hidden when disabled.

## Verification status (actual results)

Measured on Windows on 2026-10-23 with Python 3.14.3, Node 24.19.0 and npm
12.2.1:

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `python -m pytest -o addopts="" -q` in `backend/` | **44 passed** |
| Frontend tests | `npm test` in `frontend/` | **54 passed, 13 files** |
| Frontend coverage | `npm run test:coverage` | **79.56% statements, 82.15% lines** |
| TypeScript | `npm run typecheck` | exit 0 |
| Production build | `npm run build` | exit 0, `frontend/dist/` written |
| Dependency audit | `npm audit` in `frontend/` | **0 vulnerabilities** |
| Alembic migration | `alembic upgrade head` on a fresh SQLite DB | exit 0, 7 tables + `alembic_version` at `0001_initial` |
| Live server smoke test | `python app.py` + real HTTP calls | see below |

The smoke test ran the real Flask app against a temporary SQLite database with
**no** Bee credentials. Results:

* `GET /api/health` → `200 {"status":"ok","bee_configured":false}`
* `GET /api/auth/me` without a session → `401`
* `POST /api/auth/login` → `200` with the operator user
* `GET /api/auth/demo` → `200` demo account in development; login with it
  returns `200`, and the previous password returns `401` after a change
* `GET /api/connection/status` → `configured:false, reachable:false` plus the
  exact reason (`BEE_TOKEN`/`bee proxy` missing)
* `GET /api/overview`, `GET /api/tasks`, `GET /api/sync/status` → empty state,
  no fabricated counts
* `POST /api/bee/sync` → recorded `status:"failed"` with the real error, never
  `"success"`
* `GET /` and a deep link (`/conversations/123`) → `200` with the built React app
* unknown `/api/*` → JSON `404`; cross-origin `DELETE /api/data` → `403`

**Still unverified — needs your account and device:**

* No live Bee account or hardware was available here, so **no request was made
  to the real Bee API**. `/v1/me`, sync, transcripts, search and SSE were
  exercised only against the in-memory test transport in
  `backend/tests/fake_bee.py`.
* MySQL 8 was not available, so the Alembic migration was applied to SQLite
  only; it has not been run against a live MySQL server.
* Bee rate limits and plan/retention behaviour cannot be confirmed without a
  real account.

Anything the app cannot verify is shown in the UI as unreachable or not
configured; it is never displayed as connected.

## Security notes

* Bee credentials stay in server environment variables (or the local proxy);
  they are never sent to the browser or stored in the database.
* Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
* State-changing `/api/*` requests require a same-origin `Origin`/`Referer`.
* Searches and lookups use parameterised SQLAlchemy queries.
* `BEE_ALLOW_MOCK=true` is rejected when `APP_ENV=production`.
* The sign-in demo account is development-only: `/api/auth/demo` returns
  `enabled:false` when `APP_ENV=production`, and `DEMO_PASSWORD` is intentionally
  weak. Set `DEMO_LOGIN_ENABLED=false` for any shared deployment.
* `npm audit` reports **0 vulnerabilities** (React Router 7 + Vitest 5).
* `DELETE /api/data` removes only local copies; Bee is untouched.
* To disconnect completely: remove `BEE_TOKEN` (or stop `bee proxy`) and restart.

## Deployment

1. `pip install -r backend/requirements.txt` and `alembic upgrade head`.
2. `npm run build` in `frontend/`.
3. Run `python app.py` behind HTTPS (`FLASK_HOST=127.0.0.1`, a reverse proxy such
   as nginx/IIS handles TLS), with `APP_ENV=production`, a strong `SECRET_KEY`,
   `DEMO_LOGIN_ENABLED=false`, and `CORS_ORIGINS` set to the public origin.
4. Store `BEE_TOKEN` in a secret manager, not in the image.
5. Schedule `python app.py sync` at least daily so the 7-day cursor never ages
   out.
6. Run a single worker, or replace the in-process sync lock with a database
   advisory lock before scaling horizontally.

## Required Bee access, credentials and permissions

Bee's documented API does not expose granular OAuth scopes: a valid account
token grants access to that account's `/v1/*` data. This app applies least
privilege by keeping the token server-side, reading only the entities Phase 1
needs, and making exactly one write path — marking a Bee todo complete via
`PUT /v1/todos/:id`.

| Requirement | Why | Where it goes |
| --- | --- | --- |
| Bee iOS app with Developer Mode unlocked (tap Version 5×) | Bee requires this before `bee login` issues a token | Device (manual step) |
| `BEE_TOKEN` from `bee login` / `bee status` | Bearer auth to the public HTTPS endpoint | Server env / secret manager |
| **or** a running `bee proxy` + `BEE_API_MODE=proxy` | Local unauthenticated proxy that holds auth for you | Local machine only |
| Access to your own Bee account data | Conversations, daily summaries, facts, todos | Bee account |
| Bee test-user enrolment | Only needed for Threads, which Phase 1 does not use | Not required |
| `APP_USERNAME` + `APP_PASSWORD_HASH` | Dashboard operator login (separate from Bee) | Server env |
| `DEMO_PASSWORD` + `DEMO_LOGIN_ENABLED` | Development-only demo account shown on the sign-in page; never exposed in production | Server env |
| `SECRET_KEY` | Flask session signing | Server env |
| `DATABASE_URL` | SQLite (local) or MySQL 8 (deploy) | Server env |
| `CORS_ORIGINS` | Only when the React dev server is on another origin | Server env |

No Bee permission beyond the account token is requested. No webhook, contact,
or device-firmware scope is used because Bee documents none.

## Known limitations

* **Threads** are test-user-only (`403 test_user_required`); not implemented.
* **No people/contacts feature** — Bee has no such endpoint.
* **Journals, insights, locations, photos, todo suggestions, today brief** are
  documented but not surfaced in phase 1 (see the capability matrix).
* **Bee rate limits are undocumented**; the client backs off but very large
  accounts may need smaller `BEE_SYNC_PAGE_SIZE`/`BEE_SYNC_MAX_PAGES`.
* **Transcripts load on demand**; with Bee offline you get the cached copy
  flagged `stale`.
* **`/v1/changes` deletion semantics are not fully documented**; confirmed 404s
  are mirrored and full syncs correct drift.
* **SSE holds a Flask worker thread** per open stream; fine for a demo, note it
  for production scaling.
