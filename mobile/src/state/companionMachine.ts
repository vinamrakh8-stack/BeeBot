import type { ContextSource } from "../api/types";

export type CompanionState =
  | "disconnected"
  | "connected"
  | "idle"
  | "wake_word_detected"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface CompanionSnapshot {
  state: CompanionState;
  error: string | null;
  question: string | null;
  answer: string | null;
  sources: ContextSource[];
  lastQuestion: string | null;
  muted: boolean;
}

export type CompanionAction =
  | { type: "CONNECTED" }
  | { type: "READY" }
  | { type: "DISCONNECT"; message?: string }
  | { type: "WAKE_WORD_DETECTED" }
  | { type: "START_LISTENING" }
  | { type: "PROCESSING" }
  | { type: "TRANSCRIBED"; text: string }
  | {
      type: "ANSWER_READY";
      question: string;
      answer: string;
      sources: ContextSource[];
      speak: boolean;
    }
  | { type: "SPEAKING_DONE" }
  | { type: "FAIL"; message: string }
  | { type: "CANCEL" }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "RESET" };

export const initialSnapshot: CompanionSnapshot = {
  state: "disconnected",
  error: null,
  question: null,
  answer: null,
  sources: [],
  lastQuestion: null,
  muted: false,
};

export function canRetry(snapshot: CompanionSnapshot): boolean {
  return snapshot.state === "error" && Boolean(snapshot.lastQuestion);
}

export function reducer(
  snapshot: CompanionSnapshot,
  action: CompanionAction,
): CompanionSnapshot {
  switch (action.type) {
    case "CONNECTED":
      if (snapshot.state === "disconnected" || snapshot.state === "error") {
        return { ...snapshot, state: "connected", error: null };
      }
      return snapshot;

    case "READY":
      return snapshot.state === "connected"
        ? { ...snapshot, state: "idle" }
        : snapshot;

    case "DISCONNECT":
      return {
        ...snapshot,
        state: "disconnected",
        error: action.message ?? null,
        question: null,
      };

    case "WAKE_WORD_DETECTED":
      return snapshot.state === "idle" || snapshot.state === "connected"
        ? { ...snapshot, state: "wake_word_detected", error: null }
        : snapshot;

    case "START_LISTENING":
      if (
        snapshot.state === "connected" ||
        snapshot.state === "idle" ||
        snapshot.state === "wake_word_detected" ||
        snapshot.state === "error"
      ) {
        return {
          ...snapshot,
          state: "listening",
          error: null,
          question: null,
          answer: null,
          sources: [],
          lastQuestion: null,
        };
      }
      return snapshot;

    case "PROCESSING":
      return snapshot.state === "listening" || snapshot.state === "error"
        ? { ...snapshot, state: "processing", error: null }
        : snapshot;

    case "TRANSCRIBED":
      return snapshot.state === "processing"
        ? { ...snapshot, question: action.text, lastQuestion: action.text }
        : snapshot;

    case "ANSWER_READY":
      if (snapshot.state !== "processing") return snapshot;
      return {
        ...snapshot,
        state: action.speak ? "speaking" : "idle",
        question: action.question,
        answer: action.answer,
        sources: action.sources,
        lastQuestion: action.question,
        error: null,
      };

    case "SPEAKING_DONE":
      return snapshot.state === "speaking"
        ? { ...snapshot, state: "idle" }
        : snapshot;

    case "FAIL":
      return {
        ...snapshot,
        state: "error",
        error: action.message,
        question: null,
      };

    case "CANCEL":
      if (snapshot.state === "disconnected") return snapshot;
      return {
        ...snapshot,
        state: "idle",
        error: null,
        question: null,
      };

    case "SET_MUTED":
      return { ...snapshot, muted: action.muted };

    case "RESET":
      return snapshot.state === "error"
        ? { ...snapshot, state: "idle", error: null }
        : snapshot;

    default:
      return snapshot;
  }
}
