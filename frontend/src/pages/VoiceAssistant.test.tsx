import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VoiceAssistant from "./VoiceAssistant";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

const STATUS = {
  provider: "openai_compatible",
  configured: true,
  base_url: "https://ai.example.invalid/v1",
  model: "gpt-4o-mini",
  stt_model: "whisper-1",
  tts_model: "tts-1",
  tts_voice: "alloy",
  timeout_seconds: 30,
  max_context_sources: 8,
  rate_limit_per_minute: 20,
  max_audio_bytes: 8000000,
  wake_word: {
    phrase: "Hey Bee",
    engine: "disabled",
    available: false,
    local_engine_bundled: false,
  },
  retrieval: { mode: "keyword", embeddings: false, note: "Keyword retrieval only." },
};

class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start() {
    FakeRecognition.last = this;
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Voice assistant page", () => {
  it("is honest when microphone APIs are unavailable", async () => {
    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/assistant/status")) return jsonResponse(STATUS);
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<VoiceAssistant />);

    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
    expect(screen.getByText(/Wake-word detection is not active in this build/i)).toBeInTheDocument();
    expect(screen.getByText(/local engine bundled: no/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Allow microphone" }));
    expect(
      await screen.findByText(/Microphone access is not available in this browser/i),
    ).toBeInTheDocument();
  });

  it("turns a finalized transcript into a grounded answer", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: FakeRecognition,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });

    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/assistant/status")) return jsonResponse(STATUS);
      if (url.endsWith("/api/assistant/chat") && init?.method === "POST") {
        return jsonResponse({
          answer: "Your roadmap review is tomorrow [S1].",
          grounded: true,
          clarification_needed: false,
          model: "gpt-4o-mini",
          generated_at: "2026-02-02T03:00:00Z",
          sources: [
            {
              kind: "task",
              ref: "task:-1",
              id: -1,
              title: "Task",
              snippet: "Review the roadmap tomorrow",
              occurred_at: null,
              route: "/tasks",
              verified: true,
              score: 1,
              metadata: {},
            },
          ],
        });
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<VoiceAssistant />);
    await screen.findByText("Ready");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Hold to talk" }));
    expect((await screen.findAllByText("Listening…")).length).toBeGreaterThan(0);

    await act(async () => {
      FakeRecognition.last?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: "When is my roadmap review?" } }],
      });
      FakeRecognition.last?.onend?.();
    });

    expect(
      await screen.findByText("Your roadmap review is tomorrow [S1]."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("You said")).toBeInTheDocument(),
    );
  });
});
