import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Settings from "./Settings";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithProviders,
} from "../test/testUtils";

const CONNECTION = {
  configured: true,
  mode: "token",
  base_url: "https://api.developer.bee.amazon.dev",
  reachable: true,
  account: { id: 7, name: "Test Operator", timezone: "UTC" },
  error: null,
  sync: {
    last_synced_at: null,
    last_full_sync_at: null,
    cursor_present: false,
    running: false,
    last_run: null,
  },
};

const PRIVACY = {
  stored: { conversations: 0, daily_summaries: 0, memories: 0, tasks: 0 },
  retention: "Local copies stay until deleted.",
  credentials: "The Bee token stays on the server.",
  sources: ["Conversations and transcripts", "Daily summaries"],
};

function installSettingsFetch(overrides?: {
  syncResponse?: () => Response;
}) {
  return installFetch((url, init) => {
    if (url.endsWith("/api/auth/me")) return currentUserResponse();
    if (url.endsWith("/api/bee/status")) return jsonResponse(CONNECTION);
    if (url.includes("/api/sync/runs")) return jsonResponse([]);
    if (url.endsWith("/api/settings/privacy")) return jsonResponse(PRIVACY);
    if (url.includes("/api/bee/sync") && init?.method === "POST") {
      return overrides?.syncResponse
        ? overrides.syncResponse()
        : jsonResponse({ message: "unexpected" }, 500);
    }
    return jsonResponse({ message: "Unexpected" }, 404);
  });
}

describe("Settings page", () => {
  it("shows a loading state while checking the connection", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderWithProviders(<Settings />);

    expect(await screen.findByText("Checking connection…")).toBeInTheDocument();
  });

  it("shows the verified connection state and account", async () => {
    installSettingsFetch();
    renderWithProviders(<Settings />);

    expect(await screen.findByText("Connected account")).toBeInTheDocument();
    expect(screen.getByText("configured")).toBeInTheDocument();
    expect(screen.getByText("reachable")).toBeInTheDocument();
    expect(screen.getByText("Test Operator")).toBeInTheDocument();
    expect(screen.getByText("No sync has run yet.")).toBeInTheDocument();
  });

  it("reports a failed sync instead of claiming success", async () => {
    const user = userEvent.setup();
    installSettingsFetch({
      syncResponse: () =>
        jsonResponse({
          id: 1,
          trigger: "manual",
          status: "failed",
          mode: "full",
          started_at: "2026-10-23T00:00:00Z",
          finished_at: "2026-10-23T00:00:01Z",
          counts: {},
          error: "Bee is not configured. Set BEE_TOKEN.",
        }),
    });
    renderWithProviders(<Settings />);

    await screen.findByText("Connected account");
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bee is not configured. Set BEE_TOKEN.",
    );
    expect(screen.queryByText("Sync completed.")).not.toBeInTheDocument();
  });
});
