import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Activity from "./Activity";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithRouter,
} from "../test/testUtils";

const ITEM = {
  kind: "conversation",
  bee_id: 101,
  title: "Roadmap planning",
  subtitle: "Discussed Q3 priorities",
  occurred_at: "2026-02-02T02:40:00",
};

describe("Activity page", () => {
  it("shows a loading state first", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {});
    });
    renderWithRouter(<Activity />);

    expect(await screen.findByText("Building timeline…")).toBeInTheDocument();
  });

  it("shows an empty timeline", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/activity")) return jsonResponse([]);
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Activity />);

    expect(await screen.findByText("Nothing on the timeline")).toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    const user = userEvent.setup();
    let calls = 0;
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/activity")) {
        calls += 1;
        if (calls === 1) {
          return jsonResponse({ error: "bee_unavailable", message: "No timeline." }, 503);
        }
        return jsonResponse([]);
      }
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Activity />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No timeline.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing on the timeline")).toBeInTheDocument();
  });

  it("renders merged activity with a link to the source", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/activity")) return jsonResponse([ITEM]);
      return jsonResponse({ message: "Unexpected" }, 404);
    });
    renderWithRouter(<Activity />);

    const link = await screen.findByRole("link", { name: "Roadmap planning" });
    expect(link).toHaveAttribute("href", "/conversations/101");
    expect(screen.getByText("conversation")).toBeInTheDocument();
    expect(screen.getByText("Discussed Q3 priorities")).toBeInTheDocument();
  });
});
