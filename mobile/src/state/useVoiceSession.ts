import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Speech from "expo-speech";
import { deleteAsync } from "expo-file-system/legacy";

import type { ApiClient } from "../api/client";
import type { CompanionSnapshot } from "./companionMachine";
import {
  VoiceSessionController,
  type AnswerPlayer,
  type AudioCapture,
} from "./voiceController";

const RECORDING_OPTIONS = {
  ...RecordingPresets.LOW_QUALITY,
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: {
    ...RecordingPresets.LOW_QUALITY.android,
    extension: ".m4a",
    sampleRate: 16_000,
    outputFormat: "mpeg4" as const,
    audioEncoder: "aac" as const,
    bitRate: 32_000,
  },
  ios: {
    ...RecordingPresets.LOW_QUALITY.ios,
    extension: ".m4a",
    sampleRate: 16_000,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.LOW,
  },
};

const SPEECH_MODE = {
  playsInSilentMode: true,
  interruptionMode: "doNotMix" as const,
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
  allowsBackgroundRecording: false,
};

export interface VoiceSession {
  snapshot: CompanionSnapshot;
  markConnected: () => void;
  markDisconnected: (message?: string) => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  wakeWordDetected: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  setMuted: (muted: boolean) => void;
}

export function useVoiceSession(api: ApiClient): VoiceSession {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const startedAt = useRef(0);
  const [snapshot, setSnapshot] = useState<CompanionSnapshot>(() => ({
    state: "disconnected",
    error: null,
    question: null,
    answer: null,
    sources: [],
    lastQuestion: null,
    muted: false,
  }));

  const capture = useMemo<AudioCapture>(
    () => ({
      async start() {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          throw new Error(
            "Microphone permission was denied. Enable it in the phone's Settings.",
          );
        }
        await setAudioModeAsync({
          ...SPEECH_MODE,
          allowsRecording: true,
          interruptionMode: "doNotMix",
        });
        await recorder.prepareToRecordAsync();
        recorder.record();
        startedAt.current = Date.now();
      },
      async stop() {
        const durationMs = Math.max(0, Date.now() - startedAt.current);
        await recorder.stop();
        const uri = recorder.uri;
        await setAudioModeAsync({ ...SPEECH_MODE, allowsRecording: false });
        if (!uri) throw new Error("No recording was produced. Try again.");
        return { uri, durationMs };
      },
      async cancel() {
        try {
          if (recorder.isRecording) await recorder.stop();
          const uri = recorder.uri;
          if (uri) await deleteAsync(uri).catch(() => undefined);
        } catch {
          // The recorder may already have been stopped by the OS.
        }
        await setAudioModeAsync(SPEECH_MODE);
      },
      async discard(uri: string) {
        await deleteAsync(uri).catch(() => undefined);
      },
    }),
    [recorder],
  );

  const player = useMemo<AnswerPlayer>(
    () => ({
      speak(text: string) {
        return new Promise<void>((resolve, reject) => {
          Speech.speak(text, {
            useApplicationAudioSession: false,
            onDone: resolve,
            onStopped: resolve,
            onError: reject,
          });
        });
      },
      stop() {
        return Speech.stop();
      },
    }),
    [],
  );

  const controller = useMemo(
    () =>
      new VoiceSessionController(api, capture, player, {
        onSnapshot: setSnapshot,
      }),
    [api, capture, player],
  );

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  const startListening = useCallback(() => controller.startListening(), [controller]);
  const stopListening = useCallback(() => controller.stopListening(), [controller]);
  const wakeWordDetected = useCallback(() => controller.wakeWordDetected(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const markConnected = useCallback(() => controller.markConnected(), [controller]);
  const markDisconnected = useCallback(
    (message?: string) => controller.markDisconnected(message),
    [controller],
  );
  const setMuted = useCallback((muted: boolean) => controller.setMuted(muted), [controller]);

  return {
    snapshot,
    markConnected,
    markDisconnected,
    startListening,
    stopListening,
    wakeWordDetected,
    cancel,
    retry,
    setMuted,
  };
}
