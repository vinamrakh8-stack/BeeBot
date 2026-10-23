import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createApiClient,
  isInsecureBaseUrl,
  normalizeBaseUrl,
  type FetchLike,
} from "../src/api/client";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("API client", () => {
  it("normalizes the server URL and rejects missing schemes", () => {
    expect(normalizeBaseUrl(" https://voice.example.com/ ")).toBe("https://voice.example.com");
    expect(() => normalizeBaseUrl("voice.example.com")).toThrow(ApiError);
    expect(() => normalizeBaseUrl("https://")).toThrow(ApiError);
  });

  it("treats public HTTP as insecure but allows local development HTTP", () => {
    expect(isInsecureBaseUrl("http://voice.example.com")).toBe(true);
    expect(isInsecureBaseUrl("https://voice.example.com")).toBe(false);
    expect(isInsecureBaseUrl("http://10.0.2.2:5000")).toBe(false);
    expect(isInsecureBaseUrl("http://192.168.1.20:5000")).toBe(false);
  });

  it("pairs without a bearer token and stores no secret in the URL", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = init;
      return json({
        token: "bvp_test",
        token_type: "Bearer",
        expires_at: "2027-01-01T00:00:00Z",
        user: { id: 1, username: "operator" },
        device: {
          id: 1,
          device_name: "Phone",
          created_at: "2026-10-23T00:00:00Z",
          expires_at: "2027-01-01T00:00:00Z",
        },
      });
    };
    const client = createApiClient({
      baseUrl: "https://voice.example.com/",
      token: "",
      fetchImpl,
    });
    const result = await client.pair({
      username: "operator",
      password: "secret",
      deviceName: "Phone",
    });

    expect(result.token).toBe("bvp_test");
    expect(captured?.headers).not.toHaveProperty("Authorization");
    expect(captured?.method).toBe("POST");
    expect(JSON.parse(String(captured?.body))).toEqual({
      username: "operator",
      password: "secret",
      device_name: "Phone",
    });
  });

  it("adds the bearer token to authenticated calls", async () => {
    let authorization: string | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      authorization = (init?.headers as Record<string, string>).Authorization;
      return json({ items: [], total: 0, limit: 30, offset: 0, has_more: false });
    };
    const client = createApiClient({
      baseUrl: "https://voice.example.com",
      token: "bvp_secret",
      fetchImpl,
    });
    await client.conversations();
    expect(authorization).toBe("Bearer bvp_secret");
  });

  it("retries idempotent GETs on a transient server error", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return calls === 1 ? json({ error: "busy" }, 503) : json({ ok: true });
    };
    const client = createApiClient({
      baseUrl: "https://voice.example.com",
      token: "bvp_secret",
      fetchImpl,
      retryBaseDelayMs: 0,
    });
    await expect(client.overview()).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not silently retry a question POST", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return json({ error: "busy" }, 503);
    };
    const client = createApiClient({
      baseUrl: "https://voice.example.com",
      token: "bvp_secret",
      fetchImpl,
      retryBaseDelayMs: 0,
    });
    await expect(client.ask("hello")).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  });

  it("reports 401 so the app shell can revoke the pairing", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl: FetchLike = async () =>
      json({ error: "not_authenticated", message: "Sign in required." }, 401);
    const client = createApiClient({
      baseUrl: "https://voice.example.com",
      token: "bvp_secret",
      fetchImpl,
      onUnauthorized,
    });
    await expect(client.session()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("turns a stalled request into a timeout error", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const client = createApiClient({
      baseUrl: "https://voice.example.com",
      token: "bvp_secret",
      fetchImpl,
      timeoutMs: 100,
    });
    const pending = client.deleteData();
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(110);
    await assertion;
  });
});
