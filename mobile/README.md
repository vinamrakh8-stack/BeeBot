# Bee Voice+ Companion

Expo/React Native phone client for the Voice+ Flask server.

## What it does

* Pairs with the operator account and stores an opaque bearer token in iOS
  Keychain / Android Keystore.
* Push-to-talk: short recording → server STT → server grounded answer → phone TTS.
* Optional foreground on-device wake word on supported OS versions.
* Lists conversations, tasks, daily summaries, and sync status through the
  existing owner-scoped server API.
* Supports cancellation, timeout, retry, mute, visible connection state, and
  phone revocation.

It does **not** access Bee firmware, microphone, speaker, Bluetooth, or wake-word
APIs. The phone supplies its own microphone/speaker and OS audio routing.

## Requirements

* Node 20+ (tested with Node 24.19.0, npm 12.2.1)
* A running Voice+ server with `mobile_tokens` migrated
  (`alembic upgrade head`)
* iOS/Android development tooling for a native build

## Install and test

```powershell
npm install
npm run typecheck
npm test
npx expo-doctor
npx expo export --platform android --output-dir dist
```

## Run

```powershell
npx expo start
```

Expo Go can run the core app. The optional wake-word module is not included in
Expo Go; it requires a native development build:

```powershell
npx expo run:android
# macOS:
npx expo run:ios
```

## Pair

Enter the server address (HTTPS for a deployed server, LAN address for a local
server, `http://10.0.2.2:5000` from an Android emulator), operator username and
password, and a device name. Use the same operator account as the website. The
raw token is returned once and kept only in secure storage.

## Docs

* [Mobile guide](../docs/phase3_mobile_companion.md)
* [Device capability matrix](../docs/phase3_device_capability_matrix.md)
* [Phase 3 report](../docs/phase3_implementation_report.md)
