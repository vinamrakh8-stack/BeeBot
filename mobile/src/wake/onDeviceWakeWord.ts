import { Platform } from "react-native";
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";

import { containsWakePhrase } from "./phrase";

export interface WakeWordAvailability {
  available: boolean;
  reason: string;
}

export interface WakeWordDetector {
  availability(): Promise<WakeWordAvailability>;
  start(onDetected: () => void, onUnavailable: (reason: string) => void): Promise<void>;
  stop(): Promise<void>;
}

export class WakeWordUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WakeWordUnavailableError";
  }
}

type Subscription = { remove: () => void };
type SpeechModule = {
  isRecognitionAvailable: () => boolean;
  supportsOnDeviceRecognition: () => boolean;
  getSupportedLocales: (options?: {
    androidRecognitionServicePackage?: string;
  }) => Promise<{ installedLocales: string[] }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: Record<string, unknown>) => void;
  abort: () => void;
  addListener: {
    (event: "result", listener: (event: ExpoSpeechRecognitionResultEvent) => void): Subscription;
    (event: "error", listener: (event: ExpoSpeechRecognitionErrorEvent) => void): Subscription;
    (event: "end", listener: () => void): Subscription;
  };
};

let modulePromise: Promise<SpeechModule> | null = null;

async function loadSpeechModule(): Promise<SpeechModule> {
  if (modulePromise === null) {
    modulePromise = import("expo-speech-recognition").then(
      (loaded) => loaded.ExpoSpeechRecognitionModule as SpeechModule,
    );
    // Do not cache a rejection: a later Expo Go/dev-build switch should be able
    // to report the real error instead of a stale import failure.
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise;
}

const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "language-not-supported",
  "network",
  "audio-capture",
]);

/**
 * Optional local wake-word detector.
 *
 * It uses the operating system's speech recognizer with
 * `requiresOnDeviceRecognition: true`; audio is not sent to Voice+ or to a
 * cloud recognizer. If the OS cannot guarantee on-device recognition, the
 * detector is disabled and push-to-talk remains available.
 */
export function createOnDeviceWakeWordDetector(input: {
  phrase: string;
  language: string;
}): WakeWordDetector {
  let active = false;
  let recognizing = false;
  let fired = false;
  let startAttempt = 0;
  let detectedCallback: (() => void) | null = null;
  let unavailableCallback: ((reason: string) => void) | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let subscriptions: Subscription[] = [];
  let moduleRef: SpeechModule | null = null;

  async function availability(): Promise<WakeWordAvailability> {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      return { available: false, reason: "Local wake word is supported on iOS and Android only." };
    }
    try {
      const module = await loadSpeechModule();
      moduleRef = module;
      if (!module.isRecognitionAvailable()) {
        return { available: false, reason: "The operating system has no speech recognition service." };
      }
      if (!module.supportsOnDeviceRecognition()) {
        return {
          available: false,
          reason:
            "This device does not report on-device speech recognition. Wake word stays off so audio is never streamed continuously.",
        };
      }
      if (Platform.OS === "android" && Number(Platform.Version) < 33) {
        return {
          available: false,
          reason: "Continuous on-device wake word needs Android 13 or newer.",
        };
      }
      if (Platform.OS === "android") {
        const locales = await module.getSupportedLocales({
          androidRecognitionServicePackage: "com.google.android.as",
        });
        if (!locales.installedLocales.includes(input.language)) {
          return {
            available: false,
            reason: `Download the ${input.language} offline speech model in Android settings, then try again.`,
          };
        }
      }
      return { available: true, reason: "On-device wake word is available." };
    } catch (error) {
      return {
        available: false,
        reason:
          error instanceof Error
            ? error.message
            : "Could not inspect the device speech recognizer.",
      };
    }
  }

  function clearRestart(): void {
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function removeListeners(): void {
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
  }

  function scheduleRestart(): void {
    clearRestart();
    if (!active) return;
    // Continuous recognition is not guaranteed to stay alive on every OS
    // version. Restart only while the app is idle and the user opted in.
    restartTimer = setTimeout(() => {
      restartTimer = null;
      begin();
    }, 600);
  }

  function disable(reason: string): void {
    active = false;
    clearRestart();
    removeListeners();
    try {
      moduleRef?.abort();
    } catch {
      // Native module may already be stopped.
    }
    unavailableCallback?.(reason);
  }

  function begin(): void {
    if (!active || recognizing || !moduleRef) return;
    recognizing = true;
    try {
      moduleRef.start({
        lang: input.language,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: false,
        contextualStrings: [input.phrase],
      });
    } catch (error) {
      recognizing = false;
      disable(
        error instanceof Error
          ? error.message
          : "The on-device speech recognizer could not start.",
      );
    }
  }

  function onResult(event: ExpoSpeechRecognitionResultEvent): void {
    if (!active || fired) return;
    const transcript = event.results.map((result) => result.transcript).join(" ");
    if (!containsWakePhrase(transcript, input.phrase)) return;

    fired = true;
    active = false;
    clearRestart();
    removeListeners();
    try {
      moduleRef?.abort();
    } catch {
      // Already stopped.
    }
    detectedCallback?.();
  }

  function onError(event: ExpoSpeechRecognitionErrorEvent): void {
    if (!active) return;
    recognizing = false;
    if (event.error === "aborted") return;
    if (FATAL_ERRORS.has(event.error)) {
      disable(event.message || `Speech recognition failed: ${event.error}`);
      return;
    }
    scheduleRestart();
  }

  function onEnd(): void {
    if (!active) return;
    recognizing = false;
    scheduleRestart();
  }

  return {
    availability,

    async start(onDetected, onUnavailable): Promise<void> {
      if (active) return;
      const attempt = ++startAttempt;
      const status = await availability();
      if (attempt !== startAttempt) return;
      if (!status.available) throw new WakeWordUnavailableError(status.reason);
      const module = moduleRef;
      if (!module) throw new WakeWordUnavailableError("Speech recognition is unavailable.");

      const permission = await module.requestPermissionsAsync();
      if (attempt !== startAttempt) return;
      if (!permission.granted) {
        throw new WakeWordUnavailableError(
          "Microphone or speech recognition permission was denied.",
        );
      }

      detectedCallback = onDetected;
      unavailableCallback = onUnavailable;
      fired = false;
      active = true;
      subscriptions = [
        module.addListener("result", onResult),
        module.addListener("error", onError),
        module.addListener("end", onEnd),
      ];
      begin();
    },

    async stop(): Promise<void> {
      startAttempt += 1;
      active = false;
      recognizing = false;
      clearRestart();
      removeListeners();
      try {
        moduleRef?.abort();
      } catch {
        // Already stopped.
      }
      detectedCallback = null;
      unavailableCallback = null;
    },
  };
}
