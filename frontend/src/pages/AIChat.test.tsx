import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import AIChat from "./AIChat";
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
  retrieval: {
    mode: "keyword",
    embeddings: false,
    note: "Keyword retrieval only.",
  },
};

describe("AI chat page", () => {
  it("shows the provider and generates a cited answer", async () => {
    const user = userEvent.setup();
    const fetchSpy = installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/assistant/status")) return jsonResponse(STATUS);
      if (url.endsWith("/api/assistant/chat") && init?.method === "POST") {
        return jsonResponse({
          answer: "You discussed the roadmap [S1].",
          grounded: true,
          clarification_needed: false,
          model: "gpt-4o-mini",
          generated_at: "2026-02-02T03:00:00Z",
          sources: [
            {
              kind: "conversation",
              ref: "conversation:1",
              id: 101,
              title: "Roadmap planning",
              snippet: "We discussed the Q3 roadmap.",
              occurred_at: "2026-02-02T02:40:00Z",
              route: "/conversations/101",
              verified: true,
              score: 9.2,
              metadata: {},
            },
          ],
        });
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<AIChat />);

    expect(await screen.findByText(/model: gpt-4o-mini/i)).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: /ask a question about your records/i }),
      "What did we decide about the roadmap?",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("You discussed the roadmap [S1].")).toBeInTheDocument();
    expect(screen.getByText("Roadmap planning")).toBeInTheDocument();
    expect(screen.getByText("Sources used")).toBeInTheDocument();

    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[1]?.body).toBe(
      JSON.stringify({ message: "What did we decide about the roadmap?" }),
    );
  });

  it("explains an unconfigured provider without hiding the page", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/assistant/status")) {
        return jsonResponse({
          ...STATUS,
          configured: false,
          model: "not-configured",
        });
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<AIChat />);

    expect((await screen.findAllByText("AI provider not configured")).length).toBeGreaterThan(0);
    expect(screen.getByText(/AI_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/Ask about your own records/i)).toBeInTheDocument();
  });

  it("surfaces a provider failure instead of showing a fake answer", async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/assistant/status")) return jsonResponse(STATUS);
      if (url.endsWith("/api/assistant/chat") && init?.method === "POST") {
        return jsonResponse(
          { error: "ai_unreachable", message: "The AI provider is unreachable." },
          502,
        );
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<AIChat />);

    await screen.findByText(/model: gpt-4o-mini/i);
    await user.type(screen.getByRole("textbox"), "roadmap?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("The AI provider is unreachable."),
    );
    expect(screen.queryByText(/^Answer$/)).not.toBeInTheDocument();
  });
});
