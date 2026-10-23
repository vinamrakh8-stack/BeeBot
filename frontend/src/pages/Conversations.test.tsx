import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Conversations from "./Conversations";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

const CONVERSATION = {
  bee_id: 101,
  uuid: "uuid-101",
  start_time: "2026-02-02T02:40:00",
  end_time: "2026-02-02T03:00:00",
  device_type: "ios",
  state: "processed",
  short_summary: "Roadmap planning",
  summary: "We discussed the roadmap for Q3.",
  synced_at: "2026-02-02T03:05:00",
};

function page(items: unknown[], query = "") {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    has_more: false,
    query,
  };
}

describe("Conversations page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderWithRouter(<Conversations />);

    expect(await screen.findByText("Loading conversations…")).toBeInTheDocument();
  });

  it("shows an empty state before the first sync", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations")) return jsonResponse(page([]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Conversations />);

    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
  });

  it("renders a conversation and links to its transcript", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations")) return jsonResponse(page([CONVERSATION]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Conversations />);

    const link = await screen.findByRole("link", { name: "Roadmap planning" });
    expect(link).toHaveAttribute("href", "/conversations/101");
    expect(screen.getByText(/Bee id 101/)).toBeInTheDocument();
    expect(screen.getByText("processed")).toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/conversations")) {
        calls += 1;
        if (calls === 1) {
          return jsonResponse(
            { error: "bee_unavailable", message: "Bee could not be reached." },
            503,
          );
        }
        return jsonResponse(page([]));
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Conversations />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Bee could not be reached.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No conversations yet")).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
