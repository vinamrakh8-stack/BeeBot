import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Tasks from "./Tasks";
import {
  currentUserResponse,
  installFetch,
  jsonResponse,
  renderWithProviders,
} from "../test/testUtils";

const TASK = {
  bee_id: 10,
  text: "Call the dentist",
  completed: false,
  alarm_at: null,
  bee_created_at: "2026-10-20T09:00:00",
  synced_at: "2026-10-20T09:05:00",
};

function page(items: unknown[]) {
  return {
    items,
    total: items.length,
    limit: 25,
    offset: 0,
    has_more: false,
  };
}

describe("Tasks page", () => {
  it("shows a loading state before the first response arrives", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      return new Promise<Response>(() => {
        // Intentionally never resolves: the page stays in its loading state.
      });
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByText("Loading tasks…")).toBeInTheDocument();
  });

  it("shows an empty state when Bee returns no tasks", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/tasks")) return jsonResponse(page([]));
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByText("No tasks")).toBeInTheDocument();
    expect(
      screen.getByText(/Bee extracts tasks from your conversations/i),
    ).toBeInTheDocument();
  });

  it("shows the Bee error and recovers on retry", async () => {
    const user = userEvent.setup();
    let taskCalls = 0;
    installFetch((url) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.includes("/api/tasks")) {
        taskCalls += 1;
        if (taskCalls === 1) {
          return jsonResponse(
            { error: "bee_unavailable", message: "Bee is unreachable right now." },
            503,
          );
        }
        return jsonResponse(page([]));
      }
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithProviders(<Tasks />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bee is unreachable right now.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No tasks")).toBeInTheDocument();
    expect(taskCalls).toBe(2);
  });

  it("renders tasks and writes completion to Bee before updating the row", async () => {
    const user = userEvent.setup();
    const fetchSpy = installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/tasks/10") && init?.method === "PATCH") {
        return jsonResponse({ ...TASK, completed: true });
      }
      if (url.includes("/api/tasks")) return jsonResponse(page([TASK]));
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithProviders(<Tasks />);

    const checkbox = await screen.findByRole("checkbox", {
      name: /Mark "Call the dentist" as completed/i,
    });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("Call the dentist")).toBeInTheDocument();

    await user.click(checkbox);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/tasks/10",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const patchInit = fetchSpy.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1];
    expect(patchInit?.body).toBe(JSON.stringify({ completed: true }));

    await waitFor(() => expect(checkbox).toBeChecked());
  });

  it("keeps the row unchanged and reports a failed write", async () => {
    const user = userEvent.setup();
    installFetch((url, init) => {
      if (url.endsWith("/api/auth/me")) return currentUserResponse();
      if (url.endsWith("/api/tasks/10") && init?.method === "PATCH") {
        return jsonResponse(
          { error: "bee_unavailable", message: "Bee rejected the update." },
          503,
        );
      }
      if (url.includes("/api/tasks")) return jsonResponse(page([TASK]));
      return jsonResponse({ error: "not_found", message: "Unexpected" }, 404);
    });

    renderWithProviders(<Tasks />);

    const checkbox = await screen.findByRole("checkbox");
    await user.click(checkbox);

    expect(await screen.findByText("Bee rejected the update.")).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });
});
