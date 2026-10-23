import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  createOnDeviceWakeWordDetector,
  WakeWordUnavailableError,
  type WakeWordAvailability,
} from "./onDeviceWakeWord";

export interface WakeWordState {
  availability: WakeWordAvailability | null;
  checking: boolean;
  appActive: boolean;
}

export function useWakeWord(input: {
  enabled: boolean;
  phrase: string;
  language: string;
  active: boolean;
  onDetected: () => void;
  onUnavailable: (reason: string) => void;
}): WakeWordState {
  const detector = useMemo(
    () => createOnDeviceWakeWordDetector({ phrase: input.phrase, language: input.language }),
    [input.phrase, input.language],
  );
  const [availability, setAvailability] = useState<WakeWordAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [appActive, setAppActive] = useState<AppStateStatus>(
    (AppState.currentState ?? "active") as AppStateStatus,
  );
  const callbacks = useRef(input);
  callbacks.current = input;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppActive);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!input.enabled) {
      setAvailability(null);
      void detector.stop();
      return;
    }

    setChecking(true);
    void detector
      .availability()
      .then((status) => {
        if (cancelled) return;
        setAvailability(status);
        if (!status.available) {
          callbacks.current.onUnavailable(status.reason);
          return;
        }
        if (!input.active || appActive !== "active") return;
        return detector.start(
          () => callbacks.current.onDetected(),
          (reason) => {
            callbacks.current.onUnavailable(reason);
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        const reason =
          error instanceof WakeWordUnavailableError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Local wake word could not start.";
        callbacks.current.onUnavailable(reason);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
      void detector.stop();
    };
  }, [input.enabled, input.active, appActive, detector]);

  return {
    availability,
    checking,
    appActive: appActive === "active",
  };
}
