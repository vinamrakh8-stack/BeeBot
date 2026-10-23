import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Overview from "./Overview";
import { AppProviders } from "../store";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
} from "../test/testUtils";

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

function renderOverview() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <Overview />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("Overview page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {
        // Never resolves.
      });
    });

    renderOverview();

    expect(await screen.findByText("Loading your overview…")).toBeInTheDocument();
  });

  it("shows an empty state that never pretends Bee data exists", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/overview")) return jsonResponse(emptyOverview());
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderOverview();

    expect(await screen.findByText("No Bee data yet")).toBeInTheDocument();
    expect(screen.getByText(/the sync shows the exact error instead of fake data/i)).toBeInTheDocument();
  });

  it("surfaces a connection error instead of stale counts", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/overview")) {
        return jsonResponse(
          { error: "bee_unavailable", message: "Could not reach Bee." },
          503,
        );
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderOverview();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach Bee.");
  });
});
