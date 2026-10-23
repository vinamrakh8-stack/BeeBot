import { describe, expect, it, vi } from "vitest";
import { ApiError, api, errorMessage } from "./api";
import { installFetch, jsonResponse } from "./test/testUtils";

describe("api client", () => {
  it("turns a structured error body into an ApiError", async () => {
    installFetch(() =>
      jsonResponse(
        { error: "bee_unavailable", message: "Bee is unreachable right now." },
        503,
      ),
    );

    await expect(api.get("/api/tasks")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "bee_unavailable",
      message: "Bee is unreachable right now.",
    });
  });

  it("unwraps nested detail errors", async () => {
    installFetch(() =>
      jsonResponse(
        { detail: { error: "cursor_too_old", message: "Cursor is too old." } },
        400,
      ),
    );

    await expect(api.get("/api/sync")).rejects.toMatchObject({
      status: 400,
      code: "cursor_too_old",
      message: "Cursor is too old.",
    });
  });

  it("reports a network failure with status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    const error = await api.get("/api/health").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(errorMessage(error)).toMatch(/Cannot reach the API server/);
  });

  it("returns undefined for 204 responses", async () => {
    installFetch(() => jsonResponse(null, 204));

    await expect(api.del("/api/data")).resolves.toBeUndefined();
  });

  it("broadcasts an unauthorized event for non-login requests", async () => {
    const listener = vi.fn();
    window.addEventListener("bee:unauthorized", listener);
    installFetch(() =>
      jsonResponse({ error: "not_authenticated", message: "Sign in." }, 401),
    );

    try {
      await expect(api.get("/api/conversations")).rejects.toBeInstanceOf(ApiError);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("bee:unauthorized", listener);
    }
  });

  it("does not broadcast on a failed login", async () => {
    const listener = vi.fn();
    window.addEventListener("bee:unauthorized", listener);
    installFetch(() =>
      jsonResponse({ error: "invalid_credentials", message: "Wrong password." }, 401),
    );

    try {
      await expect(
        api.post("/api/auth/login", { username: "operator", password: "nope" }),
      ).rejects.toBeInstanceOf(ApiError);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("bee:unauthorized", listener);
    }
  });

  it("sends JSON content-type when a body is present", async () => {
    const fetchSpy = installFetch(() => jsonResponse({ ok: true }));

    await api.post("/api/auth/login", { username: "operator" });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ username: "operator" }));
    expect((init?.headers as Headers).get("Content-Type")).toBe("application/json");
  });
});
