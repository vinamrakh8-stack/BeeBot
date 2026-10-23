# Phase 3 mobile companion

The companion is an Expo/React Native app in [`mobile/`](../mobile). It gives a
phone a supported way to use the Voice+ features that already exist: grounded
questions, conversations, tasks, summaries, and sync. It does **not** extend Bee
firmware or control Bee hardware. The device capability evidence is in
[`phase3_device_capability_matrix.md`](phase3_device_capability_matrix.md).

## Architecture

```
Phone app (Expo SDK 58, React Native, TypeScript)
  ├─ expo-audio        one short recording per push-to-talk press
  ├─ expo-speech       answer playback through the current OS audio route
  ├─ expo-secure-store opaque pairing token (Keychain / Keystore)
  ├─ expo-speech-recognition
  │                    optional, foreground, OS on-device wake word
  └─ expo-file-system  delete the local recording after upload/cancel
          │
          │ HTTPS + Authorization: Bearer <opaque token>
          ▼
Flask Voice+ server
  ├─ /api/mobile/pair, /api/mobile/session, /api/mobile/devices
  ├─ existing owner-scoped data and assistant routes
  ├─ Bee token and AI key stay here
  └─ SQLite / MySQL local mirror
          │
          ├─ Bee developer API (account/cloud data, sync)
          └─ optional OpenAI-compatible AI provider
```

The phone never talks to Bee or the AI provider directly. It has no Bee token,
AI key, database credential, or server secret.

## Pairing and authentication

1. The user enters the Voice+ server URL, operator username/password, and a
   device name.
2. `POST /api/mobile/pair` is rate-limited by client address (default
   `MOBILE_PAIR_RATE_LIMIT_PER_MINUTE=5`) and checks the same bcrypt operator
   password as the website.
3. The server creates a random `bvp_…` token, returns it **once**, and stores only
   its SHA-256 hash in `mobile_tokens`.
4. The app stores the raw token in Keychain/Keystore via `expo-secure-store`.
5. Every later request uses `Authorization: Bearer …`. The token's lifetime is
   `MOBILE_TOKEN_TTL_DAYS` (default 90). `last_used_at` is updated at most once
   per minute.
6. `GET /api/mobile/session` returns capabilities and operator/device metadata;
   no Bee or AI secret is included.
7. `DELETE /api/mobile/session` revokes the current phone. The Settings page on
   the website lists active phones and can revoke any of them through
   `DELETE /api/mobile/devices/<id>`.
8. A `401` on any mobile request clears the local token and returns the user to
   pairing. There is no silent refresh or sharing of the web session cookie.

The native app does not need CORS. Bearer requests are explicit credentials and
are exempt from the browser CSRF guard; cookie-authenticated browser requests
still require same-origin. The server's token lookup does not fall back to a
cookie when an `Authorization` header is present.

## Supported phone flow

| Step | Implementation |
|---|---|
| Ask | Hold the Talk button. `expo-audio` records mono 16 kHz AAC in the app cache. |
| Stop | Release. Recording is capped at 15 s and shorter than 350 ms is rejected locally. |
| Transcribe | Upload once to `POST /api/assistant/transcribe`; the server calls its configured STT provider. |
| Retrieve | `POST /api/assistant/chat` uses the existing owner-scoped keyword retrieval and grounded prompt. |
| Answer | The answer and cited sources are displayed. Unless muted, `expo-speech` reads the answer on the current OS route. |
| Cleanup | The local recording is deleted after transcription succeeds, fails, times out, or is cancelled. |
| Cancel | Cancels the recording, aborts the in-flight request, stops speech, and returns to Ready. |
| Retry | Re-asks the last transcribed question without recording again. |
| Mute | Stops current speech and suppresses future spoken answers; text answers remain. |

Timeouts are deliberately bounded: 15 s listen, 45 s processing, 120 s playback,
20 s default API request, 60 s for STT/chat, and 90 s for a manual Bee sync call.
Network errors are shown; idempotent GETs retry with backoff, while question POSTs
are not silently retried.

## States

The state machine is in `mobile/src/state/companionMachine.ts`; side effects and
cancellation are in `mobile/src/state/voiceController.ts`.

| State | UI label | Meaning |
|---|---|---|
| `disconnected` | Offline | No validated server session, or the connection was lost. |
| `connected` | Connected | Session validated; the workspace is initialising. |
| `idle` | Ready | Push-to-talk is available. |
| `wake_word_detected` | Wake word heard | The local detector fired; capture starts immediately. |
| `listening` | Listening | Microphone is recording; releasing sends. |
| `processing` | Thinking | Upload, transcription, retrieval, or answer generation is in progress. |
| `speaking` | Speaking | Answer audio is playing on the phone. |
| `error` | Needs attention | Recoverable failure with Cancel / Retry / reconnect options. |

Valid transitions:

```
disconnected -> connected -> idle
idle|connected -> wake_word_detected -> listening
connected|idle|wake_word_detected|error -> listening -> processing
processing -> speaking -> idle
processing -> idle              (muted answer or no speech)
listening|processing|speaking|wake-word|error -> idle   (cancel)
any -> error -> processing      (retry a transcribed question)
any -> disconnected             (lost session or unpair)
```

A visible status pill always shows the current state. Connection status is never
inferred from a cached value; it is set from a successful session response.

## Optional wake word

Wake word is **off by default** and is a phone feature, not a Bee feature.

It is enabled only when all of these are true:

* the platform is iOS or Android;
* `isRecognitionAvailable()` reports an OS recognizer;
* `supportsOnDeviceRecognition()` reports on-device support;
* on Android, the device is Android 13+ and the `en-US` offline model is installed
  for `com.google.android.as`;
* the user grants microphone permission;
* the app is in the foreground, the Talk tab is open, and the state is
  Ready/Connected.

`requiresOnDeviceRecognition: true` is always set. If those conditions are not
met, the switch turns itself off and shows the reason; push-to-talk remains
available. The detector uses word-boundary phrase matching and does not upload
wake audio to Voice+. It stops when listening starts, when the Talk tab is left,
when the app leaves the foreground, or when the user turns it off.

This module requires a **custom Expo development build**. It is not part of the
standard Expo Go native runtime; the app loads it lazily, so Expo Go can still run
the core push-to-talk app and reports wake word as unavailable.

## Audio, interruptions, and background limits

* Recording uses the phone microphone only for the held press or an active local
  wake detector. The UI shows Listening.
* Playback uses `expo-speech` and the phone's current route. Bluetooth earbuds and
  speakers are handled by iOS/Android, not by this app. Bee's speaker is never
  used or claimed.
* The audio session uses `doNotMix`/recording mode while recording and resets
  after; the operating system handles phone calls and route changes.
* On any `AppState` change away from `active`, the app cancels recording,
  in-flight requests, and speech. It deliberately does not request background
  audio, background recording, a foreground service, push notifications, or
  background location.
* There is no continuous cloud audio stream. There is no mobile SSE socket; the
  Talk screen polls the overview every 60 seconds while it is visible, and every
  other screen refreshes on demand.
* The OS may suspend or kill the app. The secure token survives; the session is
  revalidated on the next launch.

## Permissions

Configured in `mobile/app.json`:

| Platform | Permission / entry | Why |
|---|---|---|
| iOS | `NSMicrophoneUsageDescription` | Push-to-talk recording. |
| iOS | `NSSpeechRecognitionUsageDescription` | Optional OS speech recognizer for the local wake word. |
| Android | `RECORD_AUDIO` | Push-to-talk and optional wake word. |
| Android | `INTERNET` | HTTPS calls to the Voice+ server. |
| Android | package visibility for Google speech services | Only to inspect the on-device speech service. |

No contacts, calendar, location, SMS, phone, Bluetooth, camera, photo, or
background-location permission is requested. The app does not request a
foreground service.

## Install and run

Tested in this environment with Node 24.19.0/npm 12.2.1 and the dependency set in
`mobile/package.json`.

```powershell
cd .\mobile
npm install
npm run typecheck
npm test

# Core app in Expo Go (wake word unavailable there):
npx expo start

# Native development build, required to test the wake-word module:
npx expo run:android
# or, on macOS:
npx expo run:ios
```

Pair from the app with:

* **Server address** — `https://voice.example.com` for a deployed server, or a
  LAN address such as `http://192.168.1.20:5000` during development. Android
  emulator uses `http://10.0.2.2:5000` for a host Flask server.
* **Operator username/password** — the same account as the website.
* **Device name** — shown in the website's Settings → Mobile companion card.

Use HTTPS outside a trusted LAN. Pairing transmits the operator password; plain
HTTP outside localhost/LAN is rejected by the app, with a warning shown as the
address is entered.

Server configuration:

```dotenv
MOBILE_TOKEN_TTL_DAYS=90
MOBILE_PAIR_RATE_LIMIT_PER_MINUTE=5
```

The server must have run `alembic upgrade head` so `mobile_tokens` exists. The
in-process pairing limiter and sync lock assume the documented single-worker
deployment or shared infrastructure.

## Data and privacy

* The Bee token, AI key, database credentials, and raw Bee database never reach
  the phone. The phone does receive the owner-scoped conversations, tasks,
  summaries, and assistant answers that the user asks it to load.
* The raw pairing token is never stored in the server database; only its SHA-256
  hash is stored.
* The password is used only for the pairing request and is not persisted.
* No third-party analytics, ads, crash reporter, or direct cloud-audio SDK is used
  in the app. Question audio goes only to the Voice+ server, which forwards it to
  its configured STT provider when transcription is requested.
* Recordings are one-shot cache files and are deleted after transcription/cancel.
  Text questions and answers remain in the app's React state only; this app does
  not add them to the local Bee mirror.
* `DELETE /api/data` from Settings deletes the server's local mirror for this
  operator. It does not modify or delete Bee data. The app's token can be revoked
  separately.
* Unpairing deletes the token from secure storage and revokes it on the server.
  Revoking from the website signs out that phone on its next request.

## Automated tests

From `mobile/`:

```powershell
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android --output-dir dist
npx expo export --platform ios --output-dir dist
```

Measured result: **28 passed in 4 files (<1 s)** (state machine, controller
timeout/cancel/retry/mute/playback, API auth/retry/timeout, wake phrase matching).
`npx expo-doctor` reports **20/20 checks passed**. Android and iOS JavaScript
bundles export successfully (648/650 modules, ~1.7 MB Hermes bundle each), but no
native binary is compiled here. The app is not run on a physical phone in this
environment; see the Phase 3 report for the exact distinction.

## Manual real-device checklist

All items below are **not run** in this environment (no phone, microphone, Bee
account, or live AI provider):

1. Install the development build on a physical iOS/Android phone.
2. Pair with a test operator; confirm the website lists the device and the phone
   reports Ready.
3. Deny microphone permission, verify the explanation, enable it in OS settings,
   and retry.
4. Hold/release once; verify a visible recording indicator, transcript, cited
   answer, and speech. Repeat with mute.
5. Test a 0.2 s press, the 15 s cap, Cancel during each state, network loss, and
   Retry after a failed answer.
6. Connect Bluetooth earbuds/speakers; verify output follows the OS route. Take a
   call/route change during recording and playback.
7. Enable wake word on a supported device with the offline model; say the phrase
   and confirm detection while the app is foreground. Put the app in the
   background and confirm capture stops.
8. Trigger sync, then confirm conversations/tasks/summaries match the server.
9. Revoke the phone in the website; confirm the phone returns to pairing on its
   next request.
10. Delete local server data; confirm the Bee app and Bee account data are
    unchanged.
11. Verify no token appears in logs, URLs, or screenshots. Confirm HTTPS is used.
12. Test a real AI provider's latency, timeout, error, and answer quality.

## Battery and performance measurement protocol

No battery, CPU, memory, thermal, or network measurement is claimed. Without a
physical phone and a running server, any number would be fabricated. When hardware
is available, use this protocol and record raw results:

* **Build/device:** device model, OS version, app build, server version, network
  type, screen brightness, and whether wake word is on.
* **Scenarios:** 10 min idle foreground with wake off; 10 min idle foreground with
  wake on; 20 push-to-talk questions; 10 min backgrounded; one incremental sync;
  one 10-question burst on Wi-Fi and on cellular.
* **Android:** Android Studio Energy/CPU/Memory profilers, `adb shell dumpsys
  batterystats`, Battery Historian, `dumpsys netstats`; check for wake locks,
  background audio, and radio wakeups.
* **iOS:** Xcode Instruments Energy Log, Allocations, Leaks, and Network; check
  background modes and audio session state.
* **Metrics:** battery percentage per hour, CPU time, peak/steady memory, bytes
  sent/received, number of network requests, microphone-active duration, wake-lock
  duration, thermal state, and end-to-end question latency.
* **Acceptance checks:** no microphone activity when idle with wake off; no
  continuous network stream in the background; no background service; a recording
  stops on background; local cache files are deleted.

## Known limits

* No Bee firmware, microphone, speaker, Bluetooth, wake-word, or device background
  API exists in the documented surface. The phone cannot control Bee.
* Wake word depends on OS on-device support and a downloaded offline model; it is
  not available in Expo Go or on unsupported devices.
* The app is foreground-only. There are no push notifications or background sync.
* A manual sync request has a 90 s client timeout; the server may finish after the
  client stops waiting. Refresh the view later and check the server's sync status.
* Token expiry requires re-pairing; token rotation is not implemented.
* The server rate limiter, sync lock, and pairing limiter are in-process.
* No measurement of real-device battery, performance, Bluetooth, interruptions, or
  MySQL was performed.
