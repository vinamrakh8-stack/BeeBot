# Bee capability matrix

Verified from the official Bee developer documentation and the open-source Bee
CLI, which is the reference client for the same API:

* <https://docs.bee.computer/> — overview, Developer Mode, CLI.
* <https://docs.bee.computer/docs> — getting started, transports.
* <https://docs.bee.computer/docs/api> — `/v1/*` reference, schemas, pagination,
  `/v1/changes` 7-day cursor rule, SSE event types, threads preview.
* <https://docs.bee.computer/docs/developer-mode> — the 5× version tap.
* <https://github.com/bee-computer/bee-cli> — field names, list envelopes
  (`{<key>, next_cursor, timezone}`), `confirmed` filtering, and error payloads.

"Verified Supported" means the endpoint is documented **and** its request/response
shape was confirmed in the reference client. It does **not** mean this app's
owner account was validated against a live Bee device — see
[Account-dependent status](#account-dependent-status).

| Capability | Support Status | Official Evidence | Required Permission | Implementation Status |
|---|---|---|---|---|
| Account profile / connection check | Verified Supported | `GET /v1/me` (API reference) | Bee account with Developer Mode + token | Implemented (`GET /api/bee/status`) |
| Conversation history (list) | Verified Supported | `GET /v1/conversations` with `limit`/`cursor`, `{conversations, next_cursor, timezone}` | Bee account token | Implemented (`GET /api/conversations`) |
| Conversation detail + transcript | Verified Supported | `GET /v1/conversations/:id` (`summary`, `transcriptions[].utterances[]`) | Bee account token | Implemented, fetched on demand with cached fallback |
| Keyword search (BM25) | Verified Supported | `POST /v1/search/conversations` `{query, limit, filter, sortBy}` | Bee account token | Implemented (`GET /api/search?mode=keyword`) |
| Semantic search (neural) | Verified Supported | `POST /v1/search/conversations/neural`; conversations only | Bee account token | Implemented (`GET /api/search?mode=neural`) |
| Related conversations | Verified Supported | `GET /v1/conversations/:id/related` | Bee account token | Not implemented (out of phase-1 scope) |
| Daily summaries / recaps | Verified Supported | `GET /v1/daily`, `GET /v1/daily/:id`, `from`/`to` filtering | Bee account token | Implemented (`GET /api/summaries`) |
| Personal memory (facts), read | Verified Supported | `GET /v1/facts?confirmed=true\|false` | Bee account token | Implemented (`GET /api/memories`) |
| Personal memory (facts), write | Verified Supported | `POST/PUT/DELETE /v1/facts` | Bee account token with write access | Not used. Phase 2 memories/tasks are local records in this app's database; no fact is written to Bee |
| Tasks / todos, read | Verified Supported | `GET /v1/todos` | Bee account token | Implemented (`GET /api/tasks`) |
| Tasks, mark complete | Verified Supported | `PUT /v1/todos/:id` `{completed}` | Bee account token with write access | Implemented (`PATCH /api/tasks/:id`) |
| Todo suggestions | Verified Supported | `GET /v1/todoSuggestions`, accept/dismiss | Bee account token | Not surfaced |
| Incremental change feed | Verified Supported | `GET /v1/changes?cursor=...`; cursors older than 7 days → `cursor_too_old` | Bee account token | Implemented, with automatic full re-sync fallback |
| Real-time event stream (SSE) | Verified Supported | `GET /v1/stream`; docs state at-most-once semantics and no replay of missed events | Bee account token | Implemented (`GET /api/stream` proxy); phone uses foreground polling |
| Journals / voice notes | Verified Supported | `GET /v1/journals`, `/v1/journals/:id` | Bee account token | Not surfaced |
| Insights | Verified Supported | `GET /v1/insights` | Bee account token | Not surfaced |
| Locations | Verified Supported | `/v1/locations/clusters`, `/recent`, `/current` | Bee account token | Not surfaced (daily-summary locations are shown) |
| Photos | Verified Supported | `GET /v1/photos` | Bee account token | Not surfaced |
| Today brief (calendar/email) | Unverified | Named in the API docs as forwarded; no schema confirmed | Bee account token | Not implemented |
| Threads (chat with the Bee agent) | Requires Permission | `/v1/threads*` — docs state **preview, test users only**; `403 {"error":"test_user_required"}` | Bee test-user enrolment | Deliberately not built; surfaced as unavailable |
| People / contacts directory | Unsupported | No people/contacts endpoint exists in the reference; people appear only inside facts and transcripts | — | Not implemented by design (no invented endpoint) |
| Device hardware status (battery, firmware) | Unverified | No documented `/v1` device endpoint found; `bee status` covers CLI authentication only | — | Not shown; UI reports API/account connection instead |
| Device speaker / audio output control | Unsupported | No documented speaker or playback endpoint | — | Not claimed. Playback uses browser or phone TTS; never the Bee speaker |
| Wake-word detection | Unsupported | No documented wake-word or continuous-audio endpoint | — | Website wake word disabled; Phase 3 offers an optional foreground phone-side OS detector, not Bee |
| Third-party software installation on Bee | Unsupported | No device SDK, app package format, install command, or firmware interface in the developer docs; public org has only `bee-cli` and `bee-skill` | — | Not attempted; companion runs on the phone |
| Device microphone / live audio access | Unsupported | `/v1/conversations` returns captured conversations; no live microphone or recording-control endpoint | - | Not attempted; the phone microphone is used for push-to-talk, and only optionally for a foreground on-device wake detector |
| Bluetooth / Bee audio-route control | Unsupported | No Bluetooth, pairing, volume, or route endpoint | — | Not claimed; phone uses its OS default route |
| Device background execution | Unsupported | No public third-party app runtime; CLI background streaming runs on a computer | — | Phone app is foreground-only; no background service requested |
| Phone / SMS / third-party messaging | Unsupported | No messaging or phone-control endpoint in the API reference | — | Not implemented |
| Meeting recording / device control | Unsupported | No documented recording or device-command endpoint | — | Not claimed. Meetings are generated from authorized stored conversations |
| Webhooks (inbound) | Unsupported | No webhook API; `bee stream --webhook-endpoint` is a CLI feature | — | Not implemented |
| Raw TLS + attestation transport | Requires Setup | `https://app-api-developer.ce.bee.amazon.dev` with Bee's private CA | Bee root CA pinned in the client | Not implemented (token and local proxy modes only) |
| Developer Mode unlock | Requires Setup | Tap the Bee iOS app version 5×, then `bee login` | Physical Bee app access | Documented manual step (cannot be automated) |
| Rate limits / quotas | Unverified | Not documented publicly | — | Client retries 429/5xx with backoff and honours `Retry-After`; no invented numbers |

## Account-dependent status

The following can only be confirmed with real credentials and hardware, which
were not available while building this. The app reports the truth at runtime
rather than assuming success:

1. **Developer Mode** must be enabled in the Bee iOS app before a token can be
   issued.
2. **Plan/retention differences** change how much history is returned.
3. **Threads** return `403 test_user_required` for normal accounts; the app maps
   that to `bee_capability_unavailable`.
4. **Rate limiting** is undocumented; a very large account may need
   `BEE_SYNC_PAGE_SIZE` / `BEE_SYNC_MAX_PAGES` tuning.
5. **`/v1/todayBrief`** is referenced but has no confirmed schema, so it is
   marked Unverified and unused.

## What the app never does

* No invented endpoints, SDK methods or device capabilities.
* No simulated "connected" state: `reachable` is only true after `GET /v1/me`
  succeeds in the current request.
* No mock data in production (`BEE_ALLOW_MOCK` is rejected when
  `APP_ENV=production`; fixtures exist only under `backend/tests/`).
* No invented Bee voice, speaker, wake-word, recording, or device-control
  capability. Phase 2's assistant, speech, meetings, and learning features are
  application features over already-synced records.
* No claim that the connected Bee account was live-validated here; that requires
  your token and device.

## Verification performed in this repository

* Official pages re-read on 2026-10-23: `/docs`, `/docs/api`,
  `/docs/developer-mode`, `/docs/cli`, `/docs/mcp`, `/docs/realtime`. Every
  endpoint used by the app appears there. The public GitHub org contained only
  `bee-cli` and `bee-skill`.
* **Backend:** **97** pytest tests pass, covering auth/session security, owner
  scoping, CSRF, bearer mobile pairing, upstream 401/403/`test_user_required`/
  404/`cursor_too_old` mapping, retry and 429 handling, idempotent full sync,
  incremental change feed, pagination, deletion mirroring, tombstones, Phase 2
  memory/task/meeting/learning/insight/graph behaviour, AI-origin provenance,
  source-id mapping, export/purge coverage, and the unauthenticated/unconfigured
  states.
* **Frontend:** **74** Vitest + React Testing Library tests pass across 18 files,
  covering the auth-gated router, every page's loading/empty/error/retry states,
  task write-through, stale-cache fallback, failed-sync reporting, AI chat and
  retry, voice fallbacks, accepted-candidate provenance, revision plans, data
  export, the demo account box, paired-phone revocation, and the phone-list failure
state.
* **Mobile:** **28** Vitest tests pass across 4 files, covering the companion state
  machine, cancellation/timeout/retry/mute, API bearer/retry/timeout behaviour,
  and wake-phrase matching. Real native builds, microphone, Bluetooth, and
  on-device speech were **not** available.
* **Runtime:** with no `BEE_TOKEN`, the running Flask app reported
  `configured: false` and `reachable: false`, returned empty data sets, and
  recorded a sync attempt as `failed` with the real reason. It never reported a
  connection or a successful sync.
* **Database:** `alembic upgrade head` applied `0001_initial` → `0002_phase2` →
  `0003_learning_revision_plan` → `0004_mobile_tokens` to a fresh SQLite database,
  creating all 13 application tables plus `alembic_version`. Existing rows survive
  the additive migrations.
* **Not verified:** any request to the live Bee API, live SSE, a real AI provider,
  a real microphone/speaker/phone, Bluetooth routing, a native mobile build,
  battery/performance, MySQL 8, or Alembic against MySQL. Those require a Bee
  account, device, provider credentials, phone, and infrastructure.

## Phase 3 companion boundary

Phase 3 does not add a Bee device extension. It adds a phone companion over the
Voice+ server, with optional phone-side on-device wake word and OS audio routing.
The full device matrix and evidence are in
[`phase3_device_capability_matrix.md`](phase3_device_capability_matrix.md).

