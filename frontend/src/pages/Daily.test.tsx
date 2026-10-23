import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Daily from "./Daily";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithProviders,
} from "../test/testUtils";

const SUMMARY = {
  bee_id: 201,
  day: "2026-02-02",
  day_time: "2026-02-02T00:00:00",
  short_summary: "Busy day",
  summary: "First detail line.\nSecond detail line.",
  email_summary: "Two important emails.",
  calendar_summary: null,
  conversations_count: 2,
  locations: [{ address: "1 Test Street", latitude: 37.77, longitude: -122.42 }],
  synced_at: "2026-02-03T01:00:00",
};

function page(items: unknown[]) {
  return { items, total: items.length, limit: 10, offset: 0, has_more: false };
}

describe("Daily summaries page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderWithProviders(<Daily />);

    expect(await screen.findByText("Loading daily summaries…")).toBeInTheDocument();
  });

  it("shows an empty state when no recaps exist", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/summaries")) return jsonResponse(page([]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Daily />);

    expect(await screen.findByText("No daily summaries yet")).toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/summaries")) {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ error: "bee_unavailable", message: "No recaps." }, 503);
        }
        return jsonResponse(page([]));
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Daily />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No recaps.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No daily summaries yet")).toBeInTheDocument();
  });

  it("expands a recap to reveal its sections", async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/summaries")) return jsonResponse(page([SUMMARY]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Daily />);

    expect(await screen.findByText("Busy day")).toBeInTheDocument();
    expect(screen.getByText(/2 conversations/)).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Read more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("heading", { name: "Full summary" })).toBeInTheDocument();
    expect(screen.getByText("First detail line.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByText("1 Test Street")).toBeInTheDocument();
  });
});
