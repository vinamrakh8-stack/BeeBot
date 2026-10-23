import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import InsightsPage from "./Insights";
import KnowledgeGraphPage from "./KnowledgeGraph";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

const INSIGHTS = {
  period: "day",
  start: "2026-02-02T00:00:00Z",
  end: "2026-02-03T00:00:00Z",
  sufficient_data: true,
  counts: {
    conversations: 1,
    daily_summaries: 0,
    completed_tasks: 1,
    pending_tasks: 2,
    memories: 1,
    meetings: 1,
    learning_sets: 0,
  },
  recent_summaries: [],
  conversations: [
    {
      id: 1,
      bee_id: 101,
      start_time: "2026-02-02T02:40:00Z",
      state: "processed",
      short_summary: "Roadmap planning",
      summary: "We discussed the roadmap.",
      synced_at: "2026-02-02T03:00:00Z",
      route: "/conversations/101",
    },
  ],
  tasks: {
    completed: [
      {
        bee_id: 10,
        text: "Call the dentist",
        completed: true,
        synced_at: "2026-02-02T03:00:00Z",
      },
    ],
    pending: [],
    due_soon: [],
    overdue: [],
  },
  decisions: [
    {
      text: "Ship on Friday",
      route: "/meetings/7",
      meeting_title: "Q3 planning",
      source: "meeting",
    },
  ],
  commitments: [],
  project_activity: [{ tag: "roadmap", count: 2, basis: "tags on stored memories" }],
  trends: [
    {
      label: "Conversations",
      current: 1,
      previous: 0,
      delta: 1,
      direction: "up",
      basis: "stored record counts",
    },
  ],
  notes: "Computed locally; not productivity scores.",
  generated_at: "2026-02-02T04:00:00Z",
};

it("renders insights only from supplied records", async () => {
  installFetch((url) => {
    if (url.endsWith("/api/auth/me")) return currentUserResponse();
    if (url.includes("/api/insights")) return jsonResponse(INSIGHTS);
    return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
  });

  renderWithRouter(<InsightsPage />);

  expect(await screen.findByText("Record-count trends")).toBeInTheDocument();
  expect(screen.getByText("Roadmap planning")).toBeInTheDocument();
  expect(screen.getByText("Ship on Friday")).toBeInTheDocument();
  expect(screen.getByText("roadmap")).toBeInTheDocument();
});

it("shows an explicit empty state instead of invented trends", async () => {
  installFetch((url) => {
    if (url.endsWith("/api/auth/me")) return currentUserResponse();
    if (url.includes("/api/insights")) {
      return jsonResponse({ ...INSIGHTS, sufficient_data: false, counts: {} });
    }
    return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
  });

  renderWithRouter(<InsightsPage />);

  expect(await screen.findByText("Not enough records for this period")).toBeInTheDocument();
  expect(screen.queryByText("Record-count trends")).not.toBeInTheDocument();
});

const GRAPH = {
  nodes: [
    {
      id: "conversation:1",
      type: "conversation",
      label: "Roadmap discussion",
      route: "/conversations/101",
      verified: true,
      source: "Bee conversation",
      metadata: { bee_id: 101 },
    },
    {
      id: "memory:-1",
      type: "memory",
      label: "The roadmap prioritizes reliability",
      route: "/memory",
      verified: true,
      source: "Local memory",
      metadata: { origin: "user" },
    },
  ],
  edges: [
    {
      id: "derived:memory:-1:conversation:1",
      source: "memory:-1",
      target: "conversation:1",
      relation: "extracted_from",
      derived: true,
      confidence: 1,
      source_ref: "memory:-1",
      label: "extracted from",
    },
  ],
  generated_at: "2026-02-02T04:00:00Z",
  note: "Derived from stored records.",
};

it("renders graph nodes and saves a confirmed edge", async () => {
  const user = userEvent.setup();
  const fetchSpy = installFetch((url, init) => {
    if (url.endsWith("/api/auth/me")) return currentUserResponse();
    if (url.endsWith("/api/knowledge-graph/edges") && init?.method === "POST") {
      return jsonResponse(
        {
          id: "stored:9",
          source: "conversation:1",
          target: "memory:-1",
          relation: "related_to",
          derived: false,
          confidence: 1,
          source_ref: "knowledge_edge:9",
          label: "related to",
        },
        201,
      );
    }
    if (url.includes("/api/knowledge-graph")) return jsonResponse(GRAPH);
    return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
  });

  renderWithRouter(<KnowledgeGraphPage />);

  expect(await screen.findByText("Derived from stored records.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /conversation: Roadmap discussion/i }));
  expect(await screen.findByText(/"bee_id": 101/)).toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox"), "memory:-1");
  await user.click(screen.getByRole("button", { name: "Save relationship" }));

  await waitFor(() => {
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/knowledge-graph/edges",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
