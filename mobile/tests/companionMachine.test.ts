import { describe, expect, it } from "vitest";

import {
  initialSnapshot,
  reducer,
  type CompanionSnapshot,
} from "../src/state/companionMachine";

function run(actions: Parameters<typeof reducer>[1][]): CompanionSnapshot {
  return actions.reduce(reducer, initialSnapshot);
}

describe("companion state machine", () => {
  it("moves from disconnected through connected to idle", () => {
    const snapshot = run([{ type: "CONNECTED" }, { type: "READY" }]);
    expect(snapshot.state).toBe("idle");
  });

  it("starts listening from idle and returns to idle on cancel", () => {
    const listening = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
    ]);
    expect(listening.state).toBe("listening");
    expect(reducer(listening, { type: "CANCEL" }).state).toBe("idle");
  });

  it("ignores a wake word while already listening", () => {
    const listening = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
    ]);
    expect(reducer(listening, { type: "WAKE_WORD_DETECTED" }).state).toBe("listening");
  });

  it("goes to speaking only when answers are not muted", () => {
    const processing = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
      { type: "PROCESSING" },
      { type: "TRANSCRIBED", text: "What did I agree to?" },
    ]);
    const speaking = reducer(processing, {
      type: "ANSWER_READY",
      question: "What did I agree to?",
      answer: "You agreed to send the draft. [S1]",
      sources: [],
      speak: true,
    });
    expect(speaking.state).toBe("speaking");
    expect(speaking.lastQuestion).toBe("What did I agree to?");
    expect(reducer(speaking, { type: "SPEAKING_DONE" }).state).toBe("idle");
  });

  it("returns straight to idle for a muted answer but keeps the text", () => {
    const processing = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
      { type: "PROCESSING" },
    ]);
    const answered = reducer(processing, {
      type: "ANSWER_READY",
      question: "Question",
      answer: "Answer",
      sources: [],
      speak: false,
    });
    expect(answered.state).toBe("idle");
    expect(answered.answer).toBe("Answer");
  });

  it("keeps the transcribed question so retry can work after a failure", () => {
    const processing = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
      { type: "PROCESSING" },
      { type: "TRANSCRIBED", text: "Find my task" },
      { type: "FAIL", message: "network" },
    ]);
    expect(processing.state).toBe("error");
    expect(processing.lastQuestion).toBe("Find my task");
    expect(reducer(processing, { type: "PROCESSING" }).state).toBe("processing");
  });

  it("can always disconnect", () => {
    const error = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "FAIL", message: "offline" },
      { type: "DISCONNECT", message: "server gone" },
    ]);
    expect(error.state).toBe("disconnected");
    expect(error.error).toBe("server gone");
  });

  it("clears the retry question when a new recording starts", () => {
    const failed = run([
      { type: "CONNECTED" },
      { type: "READY" },
      { type: "START_LISTENING" },
      { type: "PROCESSING" },
      { type: "TRANSCRIBED", text: "Old question" },
      { type: "FAIL", message: "network" },
    ]);
    expect(failed.lastQuestion).toBe("Old question");
    const next = reducer(failed, { type: "START_LISTENING" });
    expect(next.state).toBe("listening");
    expect(next.lastQuestion).toBeNull();
  });
});
