import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Memory from "./Memory";
import Tasks from "./Tasks";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

function page(items: unknown[]) {
  return { items, total: items.length, limit: 25, offset: 0, has_more: false };
}

describe("Memory phase 2 actions", () => {
  it("creates a local memory and shows its origin", async () => {
    const user = userEvent.setup();
    const created = {
      bee_id: -1,
      text: "I prefer jasmine tea",
      tags: ["preference"],
      confirmed: true,
      origin: "user",
      ai_generated: false,
      created_at: "2026-02-02T03:00:00",
      updated_at: "2026-02-02T03:00:00",
      synced_at: "2026-02-02T03:00:00",
    };
    let gets = 0;
    const fetchSpy = installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/memories") && init?.method === "POST") {
        return jsonResponse(created, 201);
      }
      if (url.includes("/api/memories?")) {
        gets += 1;
        return jsonResponse(page(gets === 1 ? [] : [created]));
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<Memory />);
    await screen.findByText("No memories here");

    await user.type(
      screen.getByPlaceholderText(/a preference, decision, or fact/i),
      "I prefer jasmine tea",
    );
    await user.type(screen.getByPlaceholderText("project, preference"), "preference");
    await user.click(screen.getByRole("button", { name: "Add memory" }));

    expect(await screen.findByText("I prefer jasmine tea")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();

    const post = fetchSpy.mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/memories") && init?.method === "POST",
    );
    expect(post?.[1]?.body).toBe(
      JSON.stringify({ text: "I prefer jasmine tea", tags: ["preference"] }),
    );
  });
});

describe("Tasks phase 2 actions", () => {
  it("creates a local task linked by Bee conversation id without writing to Bee", async () => {
    const user = userEvent.setup();
    const created = {
      bee_id: -1,
      text: "Draft the proposal",
      completed: false,
      origin: "user",
      due_at: "2026-02-05T09:00:00Z",
      source_conversation_id: 1,
      ai_generated: false,
      approved: true,
      created_at: "2026-02-02T03:00:00",
      updated_at: "2026-02-02T03:00:00",
      synced_at: "2026-02-02T03:00:00",
    };
    let gets = 0;
    const fetchSpy = installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/tasks") && init?.method === "POST") {
        return jsonResponse(created, 201);
      }
      if (url.includes("/api/tasks?")) {
        gets += 1;
        return jsonResponse(page(gets === 1 ? [] : [created]));
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithRouter(<Tasks />);
    await screen.findByText("No tasks");

    await user.type(screen.getByPlaceholderText("What needs to happen?"), "Draft the proposal");
    await user.type(
      screen.getByLabelText("Source Bee conversation id (optional)"),
      "42",
    );
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByText("Draft the proposal")).toBeInTheDocument();
    const post = fetchSpy.mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/tasks") && init?.method === "POST",
    );
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.text).toBe("Draft the proposal");
    expect(body.source_bee_id).toBe(42);
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });
});
