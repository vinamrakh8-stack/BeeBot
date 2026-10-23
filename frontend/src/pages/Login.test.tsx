import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Login from "./Login";
import { AppProviders } from "../store";
import {
  installFetch,
  jsonResponse,
  unauthenticatedResponse,
} from "../test/testUtils";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AppProviders>
        <Login />
      </AppProviders>
    </MemoryRouter>,
  );
}

const DEMO_DISABLED = jsonResponse({ enabled: false });

describe("Login page", () => {
  it("disables submit until both fields are filled", async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith("/api/auth/demo")) return DEMO_DISABLED;
      return unauthenticatedResponse();
    });
    renderLogin();

    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Username"), "operator");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    expect(submit).toBeEnabled();
  });

  it("shows the server's authentication error", async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith("/api/auth/demo")) return DEMO_DISABLED;
      if (url.endsWith("/api/auth/login")) {
        return jsonResponse(
          { error: "invalid_credentials", message: "Invalid username or password." },
          401,
        );
      }
      return unauthenticatedResponse();
    });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "operator");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password.",
    );
  });

  it("shows the development demo account and fills the form", async () => {
    const user = userEvent.setup();
    installFetch((url) => {
      if (url.endsWith("/api/auth/demo")) {
        return jsonResponse({
          enabled: true,
          username: "operator",
          password: "123456",
        });
      }
      return unauthenticatedResponse();
    });
    renderLogin();

    expect(await screen.findByText("Demo account")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use demo account" }));

    expect(screen.getByLabelText("Username")).toHaveValue("operator");
    expect(screen.getByLabelText("Password")).toHaveValue("123456");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("hides the demo box when the server disables it", async () => {
    installFetch((url) => {
      if (url.endsWith("/api/auth/demo")) return DEMO_DISABLED;
      return unauthenticatedResponse();
    });
    renderLogin();

    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByText("Demo account")).not.toBeInTheDocument();
  });
});
