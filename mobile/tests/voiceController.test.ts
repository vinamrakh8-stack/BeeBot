import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../src/api/client";
import type { ChatResponse } from "../src/api/types";
import {
  VoiceSessionController,
  type AnswerPlayer,
  type AudioCapture,
  type VoiceSessionApi,
} from "../src/state/voiceController";

function answer(text = "The answer. [S1]"): ChatResponse {
  return {
    answer: text,
    sources: [],
    grounded: true,
    clarification_needed: false,
    model: "test",
    generated_at: "2026-10-23T10:00:00Z",
  };
}

function capture(): AudioCapture & {
  starts: number;
  cancels: number;
  stops: number;
  discarded: string[];
} {
  return {
    starts: 0,
    cancels: 0,
    stops: 0,
    discarded: [],
    async start() {
      this.starts += 1;
    },
    async stop() {
      this.stops += 1;
      return { uri: "file:///cache/question.m4a", durationMs: 1200 };
    },
    async cancel() {
      this.cancels += 1;
    },
    async discard(uri: string) {
      this.discarded.push(uri);
    },
  };
}

function player(): AnswerPlayer & { spoken: string[] } {
  return {
    spoken: [],
    async speak(text: string) {
      this.spoken.push(text);
    },
    async stop() {},
  };
}

function api(overrides: Partial<VoiceSessionApi> = {}): VoiceSessionApi {
  return {
    async transcribe() {
      return { text: "What did I agree to?", model: "test-stt" };
    },
    async ask() {
      return answer();
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("voice session controller", () => {
  it("records, transcribes, asks, and speaks", async () => {
    const recorder = capture();
    const speaker = player();
    const controller = new VoiceSessionController(api(), recorder, speaker, {
      onSnapshot: () => undefined,
    });
    controller.markConnected();
    expect(controller.snapshot.state).toBe("idle");

    await controller.startListening();
    expect(controller.snapshot.state).toBe("listening");
    expect(recorder.starts).toBe(1);

    await controller.stopListening();
    expect(recorder.stops).toBe(1);
    expect(recorder.discarded).toEqual(["file:///cache/question.m4a"]);
    expect(speaker.spoken).toEqual(["The answer. [S1]"]);
    expect(controller.snapshot.state).toBe("idle");
    expect(controller.snapshot.answer).toBe("The answer. [S1]");
  });

  it("times out a stuck playback and stops the player", async () => {
    const speaker = player();
    const stop = vi.fn(async () => undefined);
    speaker.stop = stop;
    speaker.speak = vi.fn(() => new Promise<void>(() => undefined));
    const controller = new VoiceSessionController(api(), capture(), speaker, {
      speakTimeoutMs: 1_000,
    });
    controller.markConnected();
    vi.useFakeTimers();

    await controller.startListening();
    const stopping = controller.stopListening();
    await vi.advanceTimersByTimeAsync(1_001);
    await stopping;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.state).toBe("error");
    expect(controller.snapshot.error).toContain("Playback took too long");
  });

  it("cancels an active recording without calling the server", async () => {
    const transcribe = vi.fn(async () => ({ text: "unused", model: "test" }));
    const recorder = capture();
    const controller = new VoiceSessionController(
      api({ transcribe }),
      recorder,
      player(),
    );
    controller.markConnected();
    await controller.startListening();
    await controller.cancel();

    expect(recorder.cancels).toBe(1);
    expect(transcribe).not.toHaveBeenCalled();
    expect(controller.snapshot.state).toBe("idle");
  });

  it("times out processing and exposes a retryable error", async () => {
    vi.useFakeTimers();
    const recorder = capture();
    const controller = new VoiceSessionController(
      api({
        transcribe: () => new Promise(() => undefined),
      }),
      recorder,
      player(),
      { processTimeoutMs: 50 },
    );
    controller.markConnected();
    await controller.startListening();
    const stopping = controller.stopListening();
    await vi.advanceTimersByTimeAsync(60);
    await stopping;

    expect(controller.snapshot.state).toBe("error");
    expect(controller.snapshot.error).toMatch(/did not answer in time/i);
  });

  it("retries only the question after a failed answer", async () => {
    let attempts = 0;
    const ask = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError("Upstream failed", 502, "bad_gateway");
      return answer("Recovered answer.");
    });
    const speaker = player();
    const controller = new VoiceSessionController(api({ ask }), capture(), speaker);
    controller.markConnected();
    await controller.startListening();
    await controller.stopListening();

    expect(controller.snapshot.state).toBe("error");
    expect(controller.snapshot.lastQuestion).toBe("What did I agree to?");

    await controller.retry();
    expect(controller.snapshot.state).toBe("idle");
    expect(speaker.spoken).toEqual(["Recovered answer."]);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("does not speak when muted", async () => {
    const speaker = player();
    const controller = new VoiceSessionController(api(), capture(), speaker);
    controller.markConnected();
    controller.setMuted(true);
    await controller.startListening();
    await controller.stopListening();

    expect(speaker.spoken).toEqual([]);
    expect(controller.snapshot.state).toBe("idle");
    expect(controller.snapshot.answer).toBe("The answer. [S1]");
  });

  it("stops speech when muted during playback", async () => {
    const speaker = player();
    const stop = vi.spyOn(speaker, "stop");
    let finishSpeech: () => void = () => undefined;
    speaker.speak = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSpeech = resolve;
        }),
    );
    const controller = new VoiceSessionController(api(), capture(), speaker);
    controller.markConnected();
    await controller.startListening();
    const stopping = controller.stopListening();

    await vi.waitFor(() => expect(controller.snapshot.state).toBe("speaking"));
    controller.setMuted(true);
    expect(stop).toHaveBeenCalled();
    expect(controller.snapshot.state).toBe("idle");
    finishSpeech();
    await stopping;
  });

  it("stops a very short press after the recorder finishes preparing", async () => {
    let finishStart: () => void = () => undefined;
    const recorder = capture();
    recorder.start = () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      });
    const transcribe = vi.fn(async () => ({ text: "Quick question", model: "test" }));
    const controller = new VoiceSessionController(
      api({ transcribe }),
      recorder,
      player(),
    );
    controller.markConnected();

    const starting = controller.startListening();
    const stopping = controller.stopListening();
    finishStart();
    await starting;
    await stopping;

    expect(recorder.stops).toBe(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.answer).toBe("The answer. [S1]");
  });

  it("treats a wake word as the start of listening", async () => {
    const recorder = capture();
    const controller = new VoiceSessionController(api(), recorder, player());
    controller.markConnected();
    await controller.wakeWordDetected();
    expect(recorder.starts).toBe(1);
    expect(controller.snapshot.state).toBe("listening");
    await controller.cancel();
  });
});
