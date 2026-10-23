# Phase 3 device capability matrix

Verified on **2026-10-23** against Bee's official documentation and public
repositories. No Bee hardware, firmware image, account token, or internal service
was available in this environment.

Legend:

* **Documented account API** — an official `/v1/*` endpoint or CLI/MCP feature.
* **Not documented** — no public interface was found in the official developer
  surface. This is a statement about the documented surface, not a claim about
  Bee's private implementation.
* **Not applicable** — the capability belongs to the phone/OS, not to Bee.
* **Not run** — the implementation exists but could not be validated on hardware.

## Decision

There is **no documented way to install third-party software on Bee, extend its
firmware, or control its microphone, speaker, Bluetooth, wake word, or background
execution**. The public developer surface is account/cloud data plus the CLI,
MCP server, and SSE stream.

Phase 3 therefore adds a **phone companion** that uses the existing Voice+ server.
It does not pretend to be a Bee device extension. The phone supplies the
microphone, wake-word option, and audio output; the server supplies the authorized
Bee data, grounded answer, and all credentials.

## Matrix

| Requirement | Official Bee support | Evidence | Phase 3 implementation | Status |
|---|---|---|---|---|
| Install / run third-party software on the Bee device | Not documented | Official docs cover Developer Mode, CLI, MCP, Skill, API, and sync only. Public `bee-computer` GitHub org contained only `bee-cli` and `bee-skill` on 2026-10-23. No device SDK, app package format, or install command is documented. | None. The companion runs on the user's phone, not on Bee. | **Impossible with documented interfaces** |
| Firmware / OS access or modification | Not documented; out of scope by project rule | No firmware download, flashing, root, or device-debug interface in the developer docs. | No firmware was accessed or modified. No platform restriction is bypassed. | **Not attempted** |
| Bee microphone / live audio capture by a third party | Not documented | `/v1/conversations` returns captured conversations and transcripts; no live audio, microphone, or recording-control endpoint is listed. | The phone microphone records a short push-to-talk question. Bee's microphone is never accessed. | **Impossible for third-party software** |
| Bee speaker / playback control | Not documented | No speaker, volume, playback, or audio-output endpoint is listed. | Answers are spoken by the phone through `expo-speech` on the current OS audio route. Bee speaker playback is not claimed. | **Impossible for third-party software** |
| Bee Bluetooth / audio-route control | Not documented | No Bluetooth, pairing, route, or HFP/A2DP endpoint is listed. | The app uses the phone's default OS route. Bluetooth earbuds/speakers work only through iOS/Android routing; the app cannot select a Bee route. | **Not applicable to Bee** |
| Custom wake word on Bee | Not documented | No wake-word, hotword, or continuous-audio API is listed. The existing `WAKE_WORD_*` server settings are website/app configuration, not Bee firmware. | Optional phone-side wake word using the OS speech recognizer with `requiresOnDeviceRecognition: true`. Disabled by default. | **Impossible on Bee; optional on phone** |
| Background execution on Bee | Not documented | Bee has no public third-party app runtime. The CLI can be run in the background **on a computer**; that is not on-device execution. | The phone app runs in the foreground. It cancels active capture and playback when the app leaves the foreground. No background service is requested. | **Impossible on Bee; not implemented on phone** |
| Phone / SMS / third-party messaging from Bee | Not documented | No SMS, phone-call, WhatsApp, or messaging endpoint is listed. Bee Threads are chats with the Bee agent, not the phone's messaging apps. | Not implemented. Destructive or external-message actions were not invented. | **Not supported** |
| Account profile and connection status | Documented account API | `GET /v1/me` | Server uses it for `/api/bee/status`; the companion reads the server session. | **Supported; implemented** |
| Conversation history and transcripts | Documented account API | `GET /v1/conversations`, `GET /v1/conversations/:id` | Existing sync; companion lists conversations and opens cached detail. | **Supported; implemented** |
| Daily summaries, facts, tasks | Documented account API | `/v1/daily`, `/v1/facts`, `/v1/todos` | Existing sync and write-through; companion lists summaries and tasks. | **Supported; implemented** |
| Real-time updates | Documented account SSE | `GET /v1/stream`; docs state **at-most-once**, internet required, missed events are not replayed, and a full sync is the reliable path | Website uses the existing SSE proxy. The phone uses foreground polling (60 s on the Talk screen) plus manual refresh, and treats sync as authoritative. | **Supported; adapted** |
| Chat with the Bee agent | **Preview, test users only** | `/v1/threads*`; docs state other accounts receive `403 test_user_required` and the API may change | Not used. The companion asks the Voice+ server's grounded assistant instead. | **Unavailable to normal accounts** |
| Pair a phone with the user's account | Not a Bee device feature | Bee uses a CLI account token, not a phone-pairing API | Voice+ adds operator pairing and an opaque bearer token. Only its SHA-256 hash is stored server-side. | **App-level feature; implemented** |
| Ask a question with authorized context | Bee has no documented device question/control endpoint | Bee Threads are preview-only; the device API is read/sync plus todo completion | Phone records a question → server transcription → owner-scoped retrieval → grounded answer → phone TTS. | **App-level feature; implemented** |
| Sync conversations, tasks, summaries | Documented account API | Same `/v1/*` data endpoints and `/v1/changes` | Companion reads the server's local mirror; manual sync calls the server, which calls Bee. | **Supported through server** |
| Audio focus, interruptions, route changes | Not a Bee API | OS responsibility | `expo-audio` recording mode + `expo-speech`; cancellation on background; OS handles calls/route changes. Real interruption behavior is not hardware-tested. | **OS-level; not run** |
| Secure token storage and deletion | Not a Bee API | OS secure storage | iOS Keychain / Android Keystore via `expo-secure-store`; server data deletion endpoint; local recording deleted after upload/cancel. | **Implemented; not run on hardware** |
| Background limits, battery, network use | Not a Bee API | iOS/Android background policy | Foreground-only, polling instead of an always-on mobile SSE socket, short recordings, no continuous cloud audio. | **Designed; not measured** |

## Evidence read

* <https://docs.bee.computer/docs> — developer overview and navigation.
* <https://docs.bee.computer/docs/developer-mode> — Developer Mode is for Bee CLI
  and Bee Skill; it is not an app-install mechanism.
* <https://docs.bee.computer/docs/api> — `/v1/*` account data, search, SSE,
  journals, insights, and the Threads preview warning.
* <https://docs.bee.computer/docs/realtime> — `bee stream` at-most-once semantics,
  event types, webhook/background CLI examples.
* <https://docs.bee.computer/docs/mcp> — the CLI acts as a local MCP server for
  assistants on the computer; it does not add device control.
* <https://github.com/bee-computer/bee-cli> — reference CLI client.
* <https://github.com/bee-computer/bee-skill> — agent skill built on the CLI and
  account API.
* Public GitHub organization listing on 2026-10-23: `bee-cli` and `bee-skill`
  only.

## What is explicitly not claimed

* No Bee SDK, firmware API, microphone API, speaker API, Bluetooth API, wake-word
  API, or background app runtime is invented.
* No audio is streamed continuously to a cloud service for wake-word detection.
* Bee is not modified by sync, task completion, data deletion, or companion use.
* The phone does not “become Bee”; it is a separate client of the Voice+ server.
* No live device/battery test result is reported because no device was available.
