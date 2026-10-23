import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AppProviders } from "../store";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/**
 * Minimal Response stand-in so tests do not depend on jsdom implementing
 * fetch/Response. Only the fields `src/api.ts` reads are provided.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: STATUS_TEXT[status] ?? `HTTP ${status}`,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/** Replace global fetch and return the spy so assertions can inspect calls. */
export function installFetch(handler: FetchHandler) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Render a page with the real app providers (auth + refresh context). */
export function renderWithProviders(ui: ReactElement) {
  return render(ui, { wrapper: AppProviders });
}

/** Render a page that contains router links inside the app providers. */
export function renderWithRouter(ui: ReactElement, entries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <AppProviders>{ui}</AppProviders>
    </MemoryRouter>,
  );
}

/** `/api/auth/me` response used by AppProviders on mount. */
export function currentUserResponse() {
  return jsonResponse({ id: 1, username: "operator", display_name: "operator" });
}

export function unauthenticatedResponse() {
  return jsonResponse(
    { error: "not_authenticated", message: "Sign in to continue." },
    401,
  );
}
