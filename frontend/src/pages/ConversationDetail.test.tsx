import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ConversationDetail from "./ConversationDetail";
import { AppProviders } from "../store";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
} from "../test/testUtils";

const DETAIL = {
  bee_id: 42,
  uuid: "uuid-42",
  start_time: "2026-02-02T02:40:00",
  end_time: "2026-02-02T03:00:00",
  device_type: "ios",
  state: "processed",
  short_summary: "Roadmap planning",
  summary: "We discussed the roadmap.\nThen the priorities.",
  primary_location: {
    address: "1 Test Street",
    latitude: 37.77,
    longitude: -122.42,
  },
  suggested_links: [{ url: "https://example.com/ref", created_at: 1_770_000_000_000 }],
  transcriptions: [
    {
      id: 1,
      realtime: false,
      utterances: [
        {
          id: 11,
          speaker: "speaker_1",
          text: "Hello there",
          spoken_at: 1_770_000_000_000,
        },
      ],
    },
  ],
  stale: false,
  synced_at: "2026-02-02T03:05:00",
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/conversations/42"]}>
      <AppProviders>
        <Routes>
          <Route path="/conversations/:beeId" element={<ConversationDetail />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("Conversation detail page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderDetail();

    expect(await screen.findByText("Loading conversation…")).toBeInTheDocument();
  });

  it("shows the error and a way back", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations/42")) {
        return jsonResponse({ error: "not_found", message: "Conversation not found." }, 404);
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Conversation not found.");
    expect(screen.getByRole("link", { name: "Back to conversations" })).toHaveAttribute(
      "href",
      "/conversations",
    );
  });

  it("renders the summary, location, links and transcript", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations/42")) return jsonResponse(DETAIL);
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Roadmap planning" }),
    ).toBeInTheDocument();
    expect(screen.getByText("We discussed the roadmap.")).toBeInTheDocument();
    expect(screen.getByText(/1 Test Street/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/ref" })).toHaveAttribute(
      "href",
      "https://example.com/ref",
    );
    expect(screen.getByText("Speaker 1")).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.queryByText(/Bee was unreachable/)).not.toBeInTheDocument();
  });

  it("flags a stale cached copy when Bee is offline", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations/42")) {
        return jsonResponse({ ...DETAIL, stale: true });
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderDetail();

    expect(await screen.findByText(/Bee was unreachable/i)).toBeInTheDocument();
  });
});
