import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Learning from "./Learning";
import LearningDetailPage from "./LearningDetail";
import Meetings from "./Meetings";
import { AppProviders } from "../store";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

const CONVERSATION = {
  id: 1,
  bee_id: 101,
  start_time: "2026-02-02T02:40:00",
  state: "processed",
  short_summary: "Roadmap planning",
  summary: "We discussed the roadmap.",
  synced_at: "2026-02-02T03:00:00",
};

const MEETING = {
  id: 7,
  conversation_id: 1,
  conversation_bee_id: 101,
  title: "Q3 planning sync",
  meeting_at: "2026-02-02T02:40:00",
  participants: ["speaker 1"],
  summary: null,
  key_points: null,
  decisions: null,
  action_items: null,
  source_kind: "conversation",
  ai_generated: false,
  created_at: "2026-02-02T03:00:00",
  updated_at: "2026-02-02T03:00:00",
};

function page(items: unknown[]) {
  return { items, total: items.length, limit: 50, offset: 0, has_more: false };
}

describe("Meetings page", () => {
  it("creates a meeting from a stored conversation", async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/meetings") && init?.method === "POST") {
        return jsonResponse(MEETING, 201);
      }
      if (url.includes("/api/meetings")) return jsonResponse(page([]));
      if (url.includes("/api/conversations")) return jsonResponse(page([CONVERSATION]));
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<Meetings />);

    expect(await screen.findByText("No meetings yet")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox"), "1");
    await user.click(screen.getByRole("button", { name: "Create meeting" }));

    expect(await screen.findByText("Q3 planning sync")).toBeInTheDocument();
    expect(screen.getByText(/participants: speaker 1/i)).toBeInTheDocument();
  });
});

describe("Learning page", () => {
  it("lists sets and links to the detail page", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/learning")) {
        return jsonResponse(
          page([
            {
              id: 3,
              title: "Database indexes",
              source_kind: "manual",
              ai_generated: false,
              created_at: "2026-02-02T03:00:00",
              updated_at: "2026-02-02T03:00:00",
              item_count: 2,
            },
          ]),
        );
      }
      if (url.includes("/api/conversations")) return jsonResponse(page([]));
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<Learning />);

    expect(await screen.findByText("Database indexes")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("shows and saves the revision plan", async () => {
    const user = userEvent.setup();
    const detail = {
      id: 3,
      title: "Database indexes",
      source_kind: "manual",
      conversation_id: null,
      conversation_bee_id: null,
      notes: "Indexes trade write cost for read speed.",
      goals: null,
      revision_plan: ["Day 1: read the notes", "Day 2: quiz yourself"],
      ai_generated: false,
      created_at: "2026-02-02T03:00:00",
      updated_at: "2026-02-02T03:00:00",
      item_count: 0,
      items: [],
    };
    const fetchSpy = installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/learning/3") && init?.method === "PATCH") {
        return jsonResponse(detail);
      }
      if (url.endsWith("/api/learning/3")) return jsonResponse(detail);
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/learning/3"]}>
        <AppProviders>
          <Routes>
            <Route path="/learning/:setId" element={<LearningDetailPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    const plan = await screen.findByLabelText("Revision plan (one step per line)");
    expect(plan).toHaveValue("Day 1: read the notes\nDay 2: quiz yourself");

    await user.clear(plan);
    await user.type(plan, "Day 1: skim{enter}Day 2: practice");
    await user.click(screen.getByRole("button", { name: "Save notes" }));

    expect(await screen.findByText(/revision plan saved/i)).toBeInTheDocument();
    const patch = fetchSpy.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/api/learning/3") && init?.method === "PATCH",
    );
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body.revision_plan).toEqual(["Day 1: skim", "Day 2: practice"]);
  });

  it("generates cards and reveals answers", async () => {
    const user = userEvent.setup();
    const detail = {
      id: 3,
      title: "Database indexes",
      source_kind: "conversation",
      conversation_id: 1,
      conversation_bee_id: 101,
      notes: null,
      goals: null,
      ai_generated: false,
      created_at: "2026-02-02T03:00:00",
      updated_at: "2026-02-02T03:00:00",
      item_count: 0,
      items: [],
    };
    const generated = {
      ...detail,
      ai_generated: true,
      notes: "An index speeds up reads but costs writes.",
      goals: ["Understand trade-offs"],
      item_count: 1,
      items: [
        {
          id: 11,
          set_id: 3,
          kind: "flashcard",
          question: "What does an index speed up?",
          answer: "Reads",
          explanation: "It avoids a full scan.",
          status: "new",
          reviews: 0,
          last_reviewed_at: null,
          ai_generated: true,
          created_at: "2026-02-02T03:00:00",
          updated_at: "2026-02-02T03:00:00",
        },
      ],
    };

    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/learning/3/generate") && init?.method === "POST") {
        return jsonResponse(generated);
      }
      if (url.endsWith("/api/learning/3")) return jsonResponse(detail);
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    render(
      <MemoryRouter initialEntries={["/learning/3"]}>
        <AppProviders>
          <Routes>
            <Route path="/learning/:setId" element={<LearningDetailPage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    await screen.findByText("Database indexes");
    await user.click(screen.getByRole("button", { name: "Generate from source" }));

    expect(await screen.findByText("What does an index speed up?")).toBeInTheDocument();
    expect(screen.getByText("Answer hidden.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByText("Reads")).toBeInTheDocument();
  });
});
