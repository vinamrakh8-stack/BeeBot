import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";
import { AppProviders } from "./store";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  unauthenticatedResponse,
} from "./test/testUtils";

function emptyOverview() {
  return {
    counts: {
      conversations: 0,
      daily_summaries: 0,
      facts: 0,
      todos_open: 0,
      todos_completed: 0,
    },
    sync: {
      last_synced_at: null,
      last_full_sync_at: null,
      cursor_present: false,
      running: false,
      last_run: null,
    },
    today_summary: null,
    recent_conversations: [],
    open_todos: [],
    recent_facts: [],
    recent_activity: [],
  };
}

function renderApp(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("App routing and layout", () => {
  it("redirects an unauthenticated visitor to the login page", async () => {
    installFetch(() => unauthenticatedResponse());
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("renders the authenticated shell and overview", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/overview")) return jsonResponse(emptyOverview());
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderApp("/");

    expect(await screen.findByText("No Bee data yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/conversations",
    );
    expect(screen.getByText(/Signed in as operator/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("reports a failed top-bar sync instead of silently succeeding", async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/overview")) return jsonResponse(emptyOverview());
      if (url.includes("/api/bee/sync") && init?.method === "POST") {
        return jsonResponse({
          id: 1,
          trigger: "manual",
          status: "failed",
          mode: "full",
          started_at: "2026-10-23T00:00:00Z",
          finished_at: "2026-10-23T00:00:01Z",
          counts: {},
          error: "Bee is not configured.",
        });
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderApp("/");

    await screen.findByText("No Bee data yet");
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bee is not configured.");
  });
});
