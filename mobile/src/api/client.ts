import type {
  ChatResponse,
  ConversationDetail,
  Conversation,
  DailySummary,
  DeleteResult,
  MobileSession,
  Overview,
  Page,
  PairResponse,
  SyncRun,
  Todo,
  TranscriptResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    code?: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retryBaseDelayMs?: number;
  onUnauthorized?: () => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("Enter the Voice+ server address.", 0, "invalid_url");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError("The server address must start with http:// or https://.", 0, "invalid_url");
  }
  try {
    new URL(trimmed);
  } catch {
    throw new ApiError("The server address is not a valid URL.", 0, "invalid_url");
  }
  return trimmed.replace(/\/+$/, "");
}

export function isInsecureBaseUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "10.0.2.2") {
    return false;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
  const match = /^172\.(\d+)\./.exec(host);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return false;
  }
  return value.toLowerCase().startsWith("http://");
}

async function parseError(response: Response): Promise<ApiError> {
  let message = response.statusText || `Request failed (${response.status})`;
  let code: string | undefined;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.message === "string") message = body.message;
    if (typeof body.error === "string") code = body.error;
  } catch {
    // Non-JSON proxy/error page: keep the HTTP status text.
  }
  const retryAfter = Number(response.headers.get("Retry-After") ?? "");
  return new ApiError(
    message,
    response.status,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const token = options.token;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 300;

  async function request<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      form?: FormData;
      auth?: boolean;
      retries?: number;
      timeoutMs?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const method = init.method ?? "GET";
    const auth = init.auth ?? true;
    const retries =
      init.retries ?? (method === "GET" || method === "HEAD" ? 2 : 0);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (init.form) {
      body = init.form;
    } else if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let attempt = 0;
    for (;;) {
      if (init.signal?.aborted) {
        throw new ApiError("Request cancelled.", 0, "cancelled");
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      init.signal?.addEventListener("abort", onAbort);
      const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timer);
        init.signal?.removeEventListener("abort", onAbort);
        if (init.signal?.aborted) {
          throw new ApiError("Request cancelled.", 0, "cancelled");
        }
        const timeout = controller.signal.aborted;
        const error = new ApiError(
          timeout
            ? "The Voice+ server took too long to respond."
            : "Cannot reach the Voice+ server. Check the address and connection.",
          0,
          timeout ? "timeout" : "network_error",
        );
        if (attempt < retries) {
          attempt += 1;
          await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener("abort", onAbort);
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const error = await parseError(response);
      if (response.status === 401 && auth) options.onUnauthorized?.();
      if (attempt < retries && RETRYABLE_STATUSES.has(response.status)) {
        const delay = Math.min(
          10_000,
          (error.retryAfterSeconds ?? retryBaseDelayMs / 1000) * 1000,
        );
        attempt += 1;
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }

  return {
    baseUrl,
    async pair(input: {
      username: string;
      password: string;
      deviceName: string;
    }): Promise<PairResponse> {
      return request<PairResponse>("/api/mobile/pair", {
        method: "POST",
        auth: false,
        retries: 0,
        body: {
          username: input.username,
          password: input.password,
          device_name: input.deviceName,
        },
      });
    },

    session(): Promise<MobileSession> {
      return request<MobileSession>("/api/mobile/session");
    },

    overview(): Promise<Overview> {
      return request<Overview>("/api/overview");
    },

    conversations(limit = 30): Promise<Page<Conversation>> {
      return request<Page<Conversation>>(`/api/conversations?limit=${limit}`);
    },

    conversation(beeId: number): Promise<ConversationDetail> {
      return request<ConversationDetail>(`/api/conversations/${beeId}`);
    },

    tasks(status: "all" | "open" | "completed" = "all", limit = 50): Promise<Page<Todo>> {
      return request<Page<Todo>>(
        `/api/tasks?limit=${limit}&status=${encodeURIComponent(status)}`,
      );
    },

    updateTask(beeId: number, completed: boolean): Promise<Todo> {
      return request<Todo>(`/api/tasks/${beeId}`, {
        method: "PATCH",
        body: { completed },
        retries: 0,
      });
    },

    summaries(limit = 30): Promise<Page<DailySummary>> {
      return request<Page<DailySummary>>(`/api/summaries?limit=${limit}`);
    },

    ask(message: string, signal?: AbortSignal): Promise<ChatResponse> {
      return request<ChatResponse>("/api/assistant/chat", {
        method: "POST",
        body: { message },
        retries: 0,
        timeoutMs: 60_000,
        signal,
      });
    },

    transcribe(uri: string, signal?: AbortSignal): Promise<TranscriptResponse> {
      const form = new FormData();
      form.append(
        "audio",
        { uri, name: "question.m4a", type: "audio/m4a" } as unknown as Blob,
      );
      return request<TranscriptResponse>("/api/assistant/transcribe", {
        method: "POST",
        form,
        retries: 0,
        timeoutMs: 60_000,
        signal,
      });
    },

    sync(full = false): Promise<SyncRun> {
      return request<SyncRun>(`/api/bee/sync?full=${full ? "true" : "false"}`, {
        method: "POST",
        retries: 0,
        timeoutMs: 90_000,
      });
    },

    deleteData(): Promise<DeleteResult> {
      return request<DeleteResult>("/api/data", { method: "DELETE", retries: 0 });
    },

    logout(): Promise<{ revoked: boolean; device_id: number }> {
      return request<{ revoked: boolean; device_id: number }>("/api/mobile/session", {
        method: "DELETE",
        retries: 0,
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
