import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorBanner, LoadingBlock, Spinner } from "./States";

describe("shared state components", () => {
  it("announces loading with a status role", () => {
    render(<LoadingBlock label="Loading memories…" />);

    expect(screen.getByText("Loading memories…")).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("renders an alert and calls the retry handler", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorBanner message="Bee is unavailable." onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("Bee is unavailable.");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry button when no handler is supplied", () => {
    render(<ErrorBanner message="Nothing to retry." />);

    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("renders an empty state with title and description", () => {
    render(
      <EmptyState title="No tasks" description="Bee has not extracted any tasks yet." />,
    );

    expect(screen.getByRole("heading", { name: "No tasks" })).toBeInTheDocument();
    expect(screen.getByText("Bee has not extracted any tasks yet.")).toBeInTheDocument();
  });

  it("exposes a screen-reader label on the spinner", () => {
    render(<Spinner label="Saving" />);

    expect(screen.getByText("Saving")).toHaveClass("sr-only");
  });
});
