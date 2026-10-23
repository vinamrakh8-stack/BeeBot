# Architecture

## Overview

```
Browser (React 18 + TypeScript, Vite)
   │  fetch("/api/…")  same-origin, HttpOnly session cookie
   ▼
Flask app (backend/app.py)
   ├── routes/            blueprints: auth, bee, conversations, summaries,
   │                      memories, tasks, search, activity, settings, stream
   ├── services/
   │     bee_client.py    HTTP transport, retries, typed errors
   │     bee_service.py   connection status, account redaction, search
   │     sync_service.py  full/incremental sync, status, purge
   │     normalize.py     wire payload → column values
   │     activity_service.py  merged timeline
   ├── models.py          SQLAlchemy models
   ├── security.py        session auth, CSRF guard, operator bootstrap
   └── migrations/        Alembic
   ▼
SQLite (default) / MySQL 8 (optional, via DATABASE_URL)
   ▲
   │ httpx
Bee developer API  https://api.developer.bee.amazon.dev/v1/*
   or local `bee proxy` http://127.0.0.1:8787/v1/*
```

## Single entry point

`backend/app.py` is both the application factory and the runner:

* `python app.py` — from the repository root (the `web/` folder) or from
  `backend/` — starts Flask, which serves `/api/*` **and** the built React app
  from `frontend/dist` (with an SPA fallback for client-side routes). The root
  file is a thin launcher that puts `backend/` on the import path.
* `python app.py init-db`, `hash-password`, `sync` are operator commands.
* `flask --app app run` and `flask --app app init-db` also work because Flask
  discovers the `create_app` factory.

In development you can instead run Vite on `:5173`; it proxies `/api` to Flask on
`:5000`, so cookies and SSE stay same-origin. For the hackathon demo, build the
frontend once and run only `python app.py`.

## Request lifecycle

1. `ensure_same_origin` (`before_request`) blocks cross-origin mutations on
   `/api/*` when an `Origin`/`Referer` is present and not allowed.
2. `login_required` reads `session["uid"]`, loads the operator, and returns
   `401 {"error":"not_authenticated"}` when absent.
3. The route opens a SQLAlchemy session from `app.extensions` (one per request,
   closed by `teardown_appcontext`).
4. Bee calls go through `BeeClient`, which maps upstream failures to typed
   errors; an app-wide handler serialises them as
   `{"error", "message", "upstream_status"}`.
5. Responses are Pydantic models dumped with UTC timestamps (`…Z`).

## Sync design

| Concern | Approach |
| --- | --- |
| Full sync | Cursor-paginated `GET /v1/conversations`, `/v1/daily`, `/v1/facts` (confirmed + pending), `/v1/todos` |
| Incremental sync | `GET /v1/changes?cursor=…`, then re-fetch only changed ids |
| Cursor lifetime | Bee rejects cursors older than 7 days (`cursor_too_old`); the run degrades to a full sync |
| Idempotency | `UNIQUE (owner_id, bee_id)` + get-then-upsert; replaying a page cannot duplicate rows |
| Deletions | `404` on a changed id → soft delete (conversations, summaries) or hard delete (facts, tasks) |
| Failure | Partial upserts are kept (safe to replay); the run is marked `failed`; the cursor does **not** advance |
| Concurrency | In-process lock → second concurrent sync gets `409` |
| Last successful sync | Written only on success; shown on Overview and Settings |
| Transcripts | Full sync stores list metadata; the detail route hydrates the transcript on demand and falls back to the cached copy with `stale: true` |
| Real time | `/api/stream` proxies Bee SSE; the UI debounces refetches. No polling loop |

## Database

| Table | Purpose |
| --- | --- |
| `users` | Dashboard operator (bcrypt hash) |
| `sync_state` | Incremental cursor, last successful sync, last full sync |
| `sync_runs` | Audit trail: trigger, mode, status, per-entity counts, error |
| `conversations` | Metadata + summaries; transcript JSON filled on demand |
| `daily_summaries` | Recaps, email/calendar summaries, locations |
| `facts` | Personal memory entries and confirmation state |
| `todos` | Bee tasks, completion and reminder time |

All synced tables carry `owner_id`; every query filters on it (enforced in the
routes and covered by tests). Migrations live in `backend/migrations/` and are
managed with Alembic (`alembic upgrade head`).

## Security

* Bee credentials exist only in server environment variables, or inside the
  local `bee proxy`. They are never serialised to the browser, logged, or stored
  in the database.
* `GET /api/bee/status` returns a redacted profile (primitive fields only;
  keys named token/secret/password are dropped).
* Session cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production.
* CSRF: same-origin enforcement on state-changing `/api/*` requests.
* Parameterised SQLAlchemy queries only; no string-built SQL.
* Error messages are truncated and never include request headers.
* `BEE_ALLOW_MOCK=true` raises at startup when `APP_ENV=production`.
* Data deletion (`DELETE /api/data`) removes the local mirror only.

## Frontend

* React Router routes: Overview, Conversations, Conversation detail, Daily
  summaries, Personal memory, Tasks, Search, Activity, Settings.
* Shared components: `Layout` (nav, sync button, live indicator), `Card`,
  `Badge`, `StatCard`, `Pagination`, `ActivityFeed`, loading/empty/error states.
* `store.tsx` holds auth state, a refresh token, and the SSE subscription.
* Accessibility: skip link, labelled forms, `aria-pressed`/`aria-expanded`,
  a live region for errors, visible focus rings, reduced-motion support.
* Responsive: CSS grid shell; the sidebar becomes an off-canvas drawer under
  900px; tables scroll horizontally.

## Deliberate boundaries

* No local (non-Bee) task store: phase 1 shows Bee tasks only, so the two can
  never be confused.
* No people/contacts page: Bee exposes no such endpoint.
* No threads UI: test-user-only endpoint.
* No generated summaries: only text returned by Bee is displayed.
