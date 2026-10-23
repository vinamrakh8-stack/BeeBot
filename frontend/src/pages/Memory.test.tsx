import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Memory from "./Memory";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithProviders,
} from "../test/testUtils";

const FACT = {
  bee_id: 301,
  text: "Prefers tea over coffee",
  tags: ["preference", "drinks"],
  confirmed: true,
  bee_created_at: "2026-02-02T02:40:00",
  synced_at: "2026-02-02T03:00:00",
};

function page(items: unknown[]) {
  return { items, total: items.length, limit: 25, offset: 0, has_more: false };
}

describe("Memory page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderWithProviders(<Memory />);

    expect(await screen.findByText("Loading memories…")).toBeInTheDocument();
  });

  it("shows an empty state and explains the missing people API", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/memories")) return jsonResponse(page([]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Memory />);

    expect(await screen.findByText("No memories here")).toBeInTheDocument();
    expect(screen.getByText(/no separate contacts or people API/i)).toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/memories")) {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ error: "bee_unavailable", message: "No memories." }, 503);
        }
        return jsonResponse(page([]));
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Memory />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No memories.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No memories here")).toBeInTheDocument();
  });

  it("renders a confirmed memory with its tags", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/memories")) return jsonResponse(page([FACT]));
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithProviders(<Memory />);

    expect(await screen.findByText("Prefers tea over coffee")).toBeInTheDocument();
    expect(screen.getByText("confirmed")).toBeInTheDocument();
    expect(screen.getByText("preference")).toBeInTheDocument();
    expect(screen.getByText("drinks")).toBeInTheDocument();
  });
});
