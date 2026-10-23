# Phase 3 implementation report

Date: **2026-10-23**  
Scope: Bee capability verification and a supported mobile companion for Voice+  
Status: implementation complete; **real-device/live-service validation not run**

## 1. Outcome

Phase 3 answers the device question honestly:

> Bee's official developer surface supports account/cloud data, sync, SSE, CLI,
> MCP, and a preview Threads API. It does **not** document third-party software
> installation on the device, firmware access, microphone/speaker/Bluetooth
> control, a custom on-device wake word, or device background execution.

Therefore no Bee device-side extension was attempted. Instead the project gained
a phone companion that uses the existing Flask backend, existing database, and
existing React website integration:

* pair a phone with the operator account;
* receive an opaque bearer token and store it in OS secure storage;
* push-to-talk a question and send it to the server;
* optionally detect a wake phrase **locally on the phone** when the OS supports
  guaranteed on-device recognition;
* play the grounded answer through the phone's current OS audio route;
* review conversations, tasks, and daily summaries;
* sync through the server, manage mute/cancel/retry, and revoke the phone.

No proprietary firmware was read or modified. No Bee endpoint, SDK, hardware
capability, or test result was invented.

## 2. Capability verification

Full evidence and the status of each required capability are in
[`phase3_device_capability_matrix.md`](phase3_device_capability_matrix.md).
Summary:

| Area | Finding |
|---|---|
| Bee device app install / third-party extension | **Not documented.** No device SDK or app package interface. Public GitHub org contained `bee-cli` and `bee-skill` only. |
| Firmware / OS access | **Not documented**; not attempted. |
| Bee microphone / live audio | **No documented third-party API.** Phone microphone is used instead. |
| Bee speaker / Bluetooth / audio route | **No documented control API.** Phone OS route is used; Bee playback is not claimed. |
| Custom Bee wake word | **No documented API.** Optional phone-side OS detector only. |
| Bee background app execution | **No public third-party runtime.** CLI background streaming runs on a computer. |
| Account conversations, summaries, facts, tasks | **Documented `/v1/*`**, already integrated and synced. |
| Real-time updates | **Documented SSE** with at-most-once semantics; website uses it, phone polls in the foreground. |
| Bee agent Threads | **Preview/test users only**; not used. |
| Pairing and question flow | **App-level**, implemented over Voice+. |

## 3. Architecture decision

Chosen: **Expo/React Native companion against the existing Voice+ server**.

Reasons:

* there is no supported device-side extension surface;
* the server already owns Bee/AI credentials, owner scoping, retrieval, and
  database access;
* the phone can provide microphone, local wake-word option, TTS, secure storage,
  and OS audio routing without bypassing Bee;
* the existing React/Vite site remains the browser client.

Rejected:

* firmware modification or reverse engineering;
* pretending a cloud speech API is a Bee wake word;
* continuous microphone upload;
* storing Bee/AI credentials on the phone;
* using the Bee Threads preview as if it were generally available device control.

## 4. Backend changes

Files:

* `backend/models.py` — `MobileToken`.
* `backend/migrations/versions/0004_mobile_tokens.py` — additive table and indexes.
* `backend/security.py` — bearer extraction, SHA-256 token hash, operator
  authentication, mobile token issue/validation, CSRF exemption for explicit
  Bearer requests.
* `backend/routes/mobile.py` — pairing, session, current-device revocation,
  website-managed device list/revocation.
* `backend/routes/__init__.py`, `backend/app.py`, `backend/config.py` — route
  registration, limiter, CORS `Authorization`, TTL/rate-limit settings.
* `backend/services/rate_limit.py` — rate-limit messages distinguish pairing
  attempts from AI requests.
* `backend/schemas.py` — `MobileDeviceOut`.
* `backend/tests/test_mobile_auth.py` — 11 tests.
* `backend/tests/test_migrations.py` — added `0004` preservation test.

Security properties:

* only the token hash is persisted; the raw `bvp_…` token is returned once;
* tokens expire (`MOBILE_TOKEN_TTL_DAYS`, default 90) and can be revoked;
* pairing rate limit is in-process (`MOBILE_PAIR_RATE_LIMIT_PER_MINUTE`, default 5);
* an `Authorization` header never falls back to a browser cookie;
* bearer requests bypass CSRF only because they are explicit non-ambient
  credentials; browser cookie mutations still require same-origin;
* all existing data routes remain owner-scoped.

No existing table or row was dropped or rewritten. Migration chain:

```
0001_initial -> 0002_phase2 -> 0003_learning_revision_plan -> 0004_mobile_tokens
```

Fresh SQLite verification: head `0004_mobile_tokens`, **13 application tables +
`alembic_version`**, and existing row-preservation tests pass.

## 5. Website changes

* `frontend/src/pages/Settings.tsx` — “Mobile companion” card lists active phones
  with paired/last-used/expiry metadata and a revoke action.
* `frontend/src/types.ts` — `MobileDevice`.
* `frontend/src/pages/Settings.test.tsx` — paired-phone list/revoke test and a
  list-failure state test.
* Existing browser behavior and all Phase 1/2 pages are unchanged.

The phone never receives Bee or AI credentials. The website controls phone
revocation with the normal operator session.

## 6. Mobile companion

Source is in [`mobile/`](../mobile); setup and manual protocol are in
[`phase3_mobile_companion.md`](phase3_mobile_companion.md).

Implemented:

* `App.tsx` — pairing, session bootstrap, tabs (Talk, Conversations, Tasks,
  Summaries, Settings), visible connection states, Talk button, answer/source
  rendering, wake-word controls, data deletion, unpair.
* `src/api/client.ts` — bearer client, URL validation, timeout/cancellation,
  retry for idempotent requests, 401 callback, error mapping.
* `src/auth/storage.ts` — Keychain/Keystore token storage; refuses to continue if
  secure storage is unavailable.
* `src/state/companionMachine.ts` — eight-state machine and transitions.
* `src/state/voiceController.ts` — capture/transcribe/chat/speak orchestration,
  timeout, cancellation, retry, mute, discard, disconnect.
* `src/state/useVoiceSession.ts` — `expo-audio`, `expo-speech`,
  `expo-file-system` adapters.
* `src/wake/phrase.ts` — normalized word-boundary phrase matching.
* `src/wake/onDeviceWakeWord.ts` — lazy-loaded OS recognizer with
  `requiresOnDeviceRecognition: true`; unavailable in Expo Go, never cloud.
* `src/wake/useWakeWord.ts` — foreground/availability gating.
* `app.json` — iOS/Android identifiers, microphone/speech descriptions,
  RECORD_AUDIO/INTERNET only; no background service.
* `mobile/tests/` — 28 tests across 4 files.

Design details:

* 16 kHz mono AAC, 32 kbps, max 15 s; audio is only sent after the user holds
  Talk (or the opted-in local wake word fires).
* The local recording is deleted after upload/transcription, timeout, failure, or
  cancel.
* Answers are spoken with the OS TTS voice on the current route; Bluetooth is an
  OS concern only.
* Leaving the foreground cancels recording, requests, and playback.
* Wake word is off by default and disabled if on-device recognition or the Android
  offline model is unavailable.
* No analytics, push service, background location, contacts, SMS, or Bee hardware
  access.

## 7. Automated verification

Measured on Windows with Python 3.14.3, Node 24.19.0, npm 12.2.1.

| Check | Command | Result |
|---|---|---|
| Backend suite | `..\venv\Scripts\python.exe -m pytest -o addopts="" -q` in `backend/` | **97 passed in 135.49 s** |
| Frontend suite | `npm test -- --run` in `frontend/` | **74 passed, 18 files, 25.84 s** |
| Frontend typecheck | `npm run typecheck` | exit 0 |
| Frontend build | `npm run build` | exit 0; `dist/index-…js` 300.30 kB (88.67 kB gzip) |
| Mobile suite | `npm test` in `mobile/` | **28 passed, 4 files (<1 s)** |
| Mobile typecheck | `npm run typecheck` | exit 0 |
| Mobile JS bundle | `npx expo export --platform android`; `--platform ios` | exit 0; 648/650 modules; ~1.7 MB Hermes bundle each |
| Expo config / doctor | `npx expo config --type public`; `npx expo-doctor` | config exit 0; microphone/Internet permissions only; doctor **20/20** |
| Fresh SQLite migration | `alembic upgrade head` | exit 0; head `0004_mobile_tokens`; 13 app tables + `alembic_version` |
| Migration preservation | pytest migration tests | pass from `0001`, `0002`, and `0003` baseline |

Regression context: Phase 2 ended at 85 backend / 72 frontend tests. Phase 3 adds
12 backend tests (11 mobile auth + 1 migration) and 2 frontend tests. All previous
tests remain green. `FakeBee` and `FakeAI` remain test-only; no automated test
contacts Bee or an AI provider.

Mobile test coverage:

* state transitions, wake/cancel behavior, muted answers;
* recording → STT → chat → speech, local file discard, and playback timeout;
* quick release while the recorder is still preparing;
* cancel before upload, processing timeout, retry without re-recording;
* mute during playback and retry-question reset on a new recording;
* bearer auth, pairing without a token, GET retry, POST no-retry, 401 callback,
  network timeout;
* wake phrase normalization/word boundaries.

## 8. Automated vs manual

**Automated here:** backend auth/authorization/CSRF/rate-limit behavior, mobile
token hashing/expiry/revocation, owner scoping, migrations, frontend interactions
with mocked `fetch`, mobile API/state-machine behavior with fakes, TypeScript
checks, Android/iOS JS bundling, and the Vite production build.

**Manual only / not run here:** a real Bee account/device, live sync/SSE, a real
AI provider, a physical iOS/Android phone, microphone permission prompts, speaker
and Bluetooth routing, call/route interruptions, the optional on-device wake word,
native development builds/EAS, battery/CPU/memory/thermal measurements, MySQL 8,
and token expiry on a real clock.

No test was substituted with a simulated “pass.” No real-device or battery result
is claimed.

## 9. Device tests and battery/performance

**Status: not executed.** No Bee hardware, phone, microphone, Bluetooth device,
or live server was available. The app therefore has no measured battery, CPU,
memory, network, latency, or thermal numbers.

The reproducible protocol is in
[`phase3_mobile_companion.md#battery-and-performance-measurement-protocol`](phase3_mobile_companion.md#battery-and-performance-measurement-protocol).
It specifies devices, scenarios, profilers, metrics, and acceptance checks. Until
it is run, Phase 3 must be described as implemented and automated-tested, not
hardware-validated.

## 10. Known limitations and unsupported requests

* No Bee firmware, microphone, speaker, Bluetooth, wake-word, or background
  execution interface is used. Those device-side requirements cannot be met with
  documented Bee interfaces.
* Wake word is a phone/OS feature, not a Bee feature; it is unavailable in Expo Go,
  on unsupported devices, or without the Android offline model.
* No continuous cloud audio and no background listening; the app is foreground-only.
* No Bee Threads: preview/test-users-only and may change.
* Manual sync has a 90 s client timeout; a server sync may finish after the phone
  stops waiting.
* Token rotation is not implemented; expiry requires re-pairing.
* Pairing limiter, AI limiter, and sync lock are in-process; use one worker or
  shared infrastructure.
* `npm audit --omit=dev` reports 4 high advisories in Expo CLI's transitive
  `node-forge`/code-signing toolchain. `npm audit fix --force` proposes a breaking
  downgrade to Expo 44, so it was not applied. This is build tooling, not an app
  API path; re-check when Expo ships a compatible fix.
* MySQL 8 was not available; migrations were applied to SQLite only.
* The Android and iOS JavaScript bundles export successfully, but no native
  binary was compiled in this environment.

## 11. Files added or changed

See the repository tree for exact contents. Key entries:

```
backend/models.py
backend/schemas.py
backend/security.py
backend/routes/mobile.py
backend/routes/__init__.py
backend/app.py
backend/config.py
backend/services/rate_limit.py
backend/migrations/versions/0004_mobile_tokens.py
backend/tests/test_mobile_auth.py
backend/tests/test_migrations.py

frontend/src/pages/Settings.tsx
frontend/src/pages/Settings.test.tsx
frontend/src/types.ts

mobile/App.tsx
mobile/app.json
mobile/package.json
mobile/package-lock.json
mobile/README.md
mobile/src/api/{client,types}.ts
mobile/src/auth/storage.ts
mobile/src/state/{companionMachine,voiceController,useVoiceSession}.ts
mobile/src/wake/{phrase,onDeviceWakeWord,useWakeWord}.ts
mobile/tests/*.test.ts

docs/phase3_device_capability_matrix.md
docs/phase3_mobile_companion.md
docs/phase3_implementation_report.md
docs/bee_capability_matrix.md
docs/architecture.md
README.md
.env.example
.gitignore
```

## 12. Reproduction

```powershell
# Backend
cd .\backend
..\venv\Scripts\python.exe -m pytest -o addopts="" -q

# Website
cd ..\frontend
npm test -- --run
npm run typecheck
npm run build

# Companion
cd ..\mobile
npm run typecheck
npm test
npx expo export --platform android --output-dir dist
npx expo export --platform ios --output-dir dist

# Database
cd ..\backend
$env:DATABASE_URL = "sqlite:///./fresh.db"
$env:APP_ENV = "test"
..\venv\Scripts\python.exe -m alembic upgrade head
```

Then follow the pairing and manual checklist in
[`phase3_mobile_companion.md`](phase3_mobile_companion.md). A development build is
required to exercise the optional wake-word native module.
