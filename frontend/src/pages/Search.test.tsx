import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Search from "./Search";
import { installFetch, jsonResponse } from "../test/testUtils";

function renderSearch() {
  return render(
    <MemoryRouter>
      <Search />
    </MemoryRouter>,
  );
}

async function submitQuery(query = "roadmap") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Search your Bee context"), query);
  await user.click(screen.getByRole("button", { name: "Search" }));
  return user;
}

describe("Search page", () => {
  it("shows a loading state while Bee searches", async () => {
    installFetch(() => new Promise<Response>(() => {}));
    renderSearch();

    await submitQuery();

    expect(await screen.findByText("Searching Bee…")).toBeInTheDocument();
  });

  it("shows an empty state when Bee returns no matches", async () => {
    installFetch(() =>
      jsonResponse({
        query: "roadmap",
        mode: "keyword",
        filter: "all",
        results: [],
        total: 0,
      }),
    );
    renderSearch();

    await submitQuery();

    expect(await screen.findByText("No results")).toBeInTheDocument();
    expect(screen.getByText(/Bee searches its own index/i)).toBeInTheDocument();
  });

  it("shows the upstream search error", async () => {
    installFetch(() =>
      jsonResponse(
        { error: "bee_unavailable", message: "Bee search is unavailable." },
        503,
      ),
    );
    renderSearch();

    await submitQuery();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bee search is unavailable.",
    );
  });

  it("renders results with a link to the conversation", async () => {
    installFetch(() =>
      jsonResponse({
        query: "roadmap",
        mode: "keyword",
        filter: "all",
        results: [{ id: 101, summary: "Roadmap planning", start_time: 1_770_000_000_000 }],
        total: 1,
      }),
    );
    renderSearch();

    await submitQuery();

    const link = await screen.findByRole("link", { name: "Roadmap planning" });
    expect(link).toHaveAttribute("href", "/conversations/101");
    expect(screen.getByText(/keyword · all/)).toBeInTheDocument();
  });
});
