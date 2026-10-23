import type { ChatResponse, ContextSource, TranscriptResponse } from "../api/types";
import { ApiError, errorMessage } from "../api/client";
import {
  initialSnapshot,
  reducer,
  type CompanionAction,
  type CompanionSnapshot,
} from "./companionMachine";

export interface AudioCapture {
  start(): Promise<void>;
  stop(): Promise<{ uri: string; durationMs: number }>;
  cancel(): Promise<void>;
  discard?(uri: string): Promise<void>;
}

export interface AnswerPlayer {
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}

export interface VoiceSessionApi {
  transcribe(uri: string, signal?: AbortSignal): Promise<TranscriptResponse>;
  ask(message: string, signal?: AbortSignal): Promise<ChatResponse>;
}

export interface VoiceSessionOptions {
  listenTimeoutMs?: number;
  processTimeoutMs?: number;
  speakTimeoutMs?: number;
  minAudioMs?: number;
  onSnapshot?: (snapshot: CompanionSnapshot) => void;
}

class ProcessTimeoutError extends Error {
  constructor() {
    super("The server did not answer in time. Try again.");
    this.name = "ProcessTimeoutError";
  }
}

function isCancelled(error: unknown): boolean {
  return error instanceof ApiError && error.code === "cancelled";
}

/**
 * Owns the voice interaction state machine and its side effects.
 *
 * It is deliberately independent of React Native so the timeout, cancellation,
 * retry, and mute paths can be unit-tested with fake adapters.
 */
export class VoiceSessionController {
  private snapshotValue: CompanionSnapshot = initialSnapshot;
  private readonly deps: {
    api: VoiceSessionApi;
    capture: AudioCapture;
    player: AnswerPlayer;
    options: Required<Omit<VoiceSessionOptions, "onSnapshot">> & {
      onSnapshot?: (snapshot: CompanionSnapshot) => void;
    };
  };
  private runId = 0;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  private requestAbort: AbortController | null = null;
  private startPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    api: VoiceSessionApi,
    capture: AudioCapture,
    player: AnswerPlayer,
    options: VoiceSessionOptions = {},
  ) {
    this.deps = {
      api,
      capture,
      player,
      options: {
        listenTimeoutMs: options.listenTimeoutMs ?? 15_000,
        processTimeoutMs: options.processTimeoutMs ?? 45_000,
        speakTimeoutMs: options.speakTimeoutMs ?? 120_000,
        minAudioMs: options.minAudioMs ?? 350,
        onSnapshot: options.onSnapshot,
      },
    };
  }

  get snapshot(): CompanionSnapshot {
    return this.snapshotValue;
  }

  getSnapshot(): CompanionSnapshot {
    return this.snapshotValue;
  }

  markConnected(): void {
    this.dispatch({ type: "CONNECTED" });
    this.dispatch({ type: "READY" });
  }

  markDisconnected(message?: string): void {
    this.runId += 1;
    this.clearListenTimer();
    this.requestAbort?.abort();
    this.requestAbort = null;
    void this.deps.capture.cancel().catch(() => undefined);
    void this.deps.player.stop().catch(() => undefined);
    this.dispatch({ type: "DISCONNECT", message });
  }

  async wakeWordDetected(): Promise<void> {
    if (this.snapshot.state !== "idle" && this.snapshot.state !== "connected") return;
    this.dispatch({ type: "WAKE_WORD_DETECTED" });
    await this.startListening();
  }

  async startListening(): Promise<void> {
    if (this.disposed) return;
    if (this.snapshot.state === "listening") return;
    if (
      this.snapshot.state === "processing" ||
      this.snapshot.state === "speaking"
    ) {
      await this.cancel();
    }
    const state = this.snapshot.state;
    if (
      state !== "connected" &&
      state !== "idle" &&
      state !== "wake_word_detected" &&
      state !== "error"
    ) {
      return;
    }

    const run = ++this.runId;
    this.dispatch({ type: "START_LISTENING" });
    const startPromise = this.deps.capture.start();
    this.startPromise = startPromise;
    try {
      await startPromise;
    } catch (error) {
      if (run === this.runId) {
        await this.deps.capture.cancel().catch(() => undefined);
        this.fail(
          errorMessage(error) || "Microphone permission was denied or the microphone is unavailable.",
        );
      }
      return;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null;
    }
    if (run !== this.runId) {
      await this.deps.capture.cancel().catch(() => undefined);
      return;
    }
    this.listenTimer = setTimeout(() => {
      void this.stopListening();
    }, this.deps.options.listenTimeoutMs);
  }

  async stopListening(): Promise<void> {
    if (this.snapshot.state === "listening" && this.startPromise) {
      // A very short press can release before permission/preparation finishes.
      // Wait for the recorder to be ready, then stop it instead of losing the
      // press or calling stop() on an unprepared recorder.
      await this.startPromise.catch(() => undefined);
    }
    if (this.snapshot.state !== "listening") return;
    this.clearListenTimer();
    const run = this.runId;
    this.dispatch({ type: "PROCESSING" });

    let audio: { uri: string; durationMs: number };
    try {
      audio = await this.deps.capture.stop();
    } catch (error) {
      if (run === this.runId) this.fail(errorMessage(error));
      return;
    }
    if (run !== this.runId) return;
    if (audio.durationMs < this.deps.options.minAudioMs) {
      await this.discard(audio.uri);
      this.fail("That was too short. Hold the button while you ask a question.");
      return;
    }

    const controller = new AbortController();
    this.requestAbort = controller;
    try {
      let transcript: TranscriptResponse;
      try {
        transcript = await this.withTimeout(
          this.deps.api.transcribe(audio.uri, controller.signal),
          this.deps.options.processTimeoutMs,
          controller,
        );
      } finally {
        // The recording is one-shot. Delete it as soon as upload/STT settles,
        // including on timeout or cancellation, instead of leaving it in cache.
        await this.discard(audio.uri);
      }
      if (run !== this.runId) return;
      const question = transcript.text.trim();
      if (!question) {
        this.fail("I could not hear a question. Try again a little closer to the microphone.");
        return;
      }
      this.dispatch({ type: "TRANSCRIBED", text: question });
      await this.askAndSpeak(question, run, controller);
    } catch (error) {
      if (run !== this.runId || isCancelled(error)) return;
      this.fail(errorMessage(error));
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null;
    }
  }

  async retry(): Promise<void> {
    const question = this.snapshot.lastQuestion;
    if (this.snapshot.state !== "error" || !question) return;

    const run = ++this.runId;
    this.dispatch({ type: "PROCESSING" });
    const controller = new AbortController();
    this.requestAbort = controller;
    try {
      await this.askAndSpeak(question, run, controller);
    } catch (error) {
      if (run === this.runId && !isCancelled(error)) this.fail(errorMessage(error));
    } finally {
      if (this.requestAbort === controller) this.requestAbort = null;
    }
  }

  async cancel(): Promise<void> {
    const wasListening = this.snapshot.state === "listening";
    this.runId += 1;
    this.clearListenTimer();
    this.requestAbort?.abort();
    this.requestAbort = null;
    if (wasListening) {
      await this.deps.capture.cancel().catch(() => undefined);
    }
    await this.deps.player.stop().catch(() => undefined);
    this.dispatch({ type: "CANCEL" });
  }

  setMuted(muted: boolean): void {
    this.dispatch({ type: "SET_MUTED", muted });
    if (muted && this.snapshot.state === "speaking") {
      void this.deps.player.stop().catch(() => undefined);
      this.dispatch({ type: "SPEAKING_DONE" });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.runId += 1;
    this.clearListenTimer();
    this.requestAbort?.abort();
    this.requestAbort = null;
    void this.deps.capture.cancel().catch(() => undefined);
    void this.deps.player.stop().catch(() => undefined);
  }

  private async askAndSpeak(
    question: string,
    run: number,
    controller: AbortController,
  ): Promise<void> {
    const response = await this.withTimeout(
      this.deps.api.ask(question, controller.signal),
      this.deps.options.processTimeoutMs,
      controller,
    );
    if (run !== this.runId) return;

    const speak = !this.snapshot.muted;
    this.dispatch({
      type: "ANSWER_READY",
      question,
      answer: response.answer,
      sources: response.sources as ContextSource[],
      speak,
    });
    if (!speak) return;

    try {
      await this.speakWithTimeout(response.answer);
    } catch (error) {
      if (run === this.runId && !isCancelled(error)) {
        this.fail(`The answer is shown, but playback failed: ${errorMessage(error)}`);
      }
      return;
    }
    if (run === this.runId && this.snapshot.state === "speaking") {
      this.dispatch({ type: "SPEAKING_DONE" });
    }
  }

  private speakWithTimeout(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.deps.player.stop().catch(() => undefined);
        reject(new Error("Playback took too long."));
      }, this.deps.options.speakTimeoutMs);
      let playback: Promise<void>;
      try {
        playback = this.deps.player.speak(text);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      playback.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private fail(message: string): void {
    this.clearListenTimer();
    this.dispatch({ type: "FAIL", message: message || "Something went wrong." });
  }

  private async discard(uri: string): Promise<void> {
    try {
      await this.deps.capture.discard?.(uri);
    } catch {
      // Best-effort cleanup; the OS cache will evict an inaccessible file.
    }
  }

  private dispatch(action: CompanionAction): void {
    if (this.disposed) return;
    this.snapshotValue = reducer(this.snapshotValue, action);
    this.deps.options.onSnapshot?.(this.snapshotValue);
  }

  private clearListenTimer(): void {
    if (this.listenTimer !== null) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new ProcessTimeoutError());
      }, timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
