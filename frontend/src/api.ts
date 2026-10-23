export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Json = Record<string, unknown>;

async function parseError(response: Response): Promise<ApiError> {
  let message = response.statusText || `Request failed (${response.status})`;
  let code: string | undefined;

  try {
    const body = (await response.json()) as Json;
    if (typeof body.message === "string") message = body.message;
    if (typeof body.error === "string") code = body.error;
    const detail = body.detail;
    if (detail && typeof detail === "object") {
      const structured = detail as Json;
      if (typeof structured.message === "string") message = structured.message;
      if (!code && typeof structured.error === "string") code = structured.error;
    } else if (typeof detail === "string") {
      message = detail;
    }
  } catch {
    // Non-JSON error body (proxy failure, HTML error page) — keep statusText.
  }

  return new ApiError(message, response.status, code);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    throw new ApiError(
      "Cannot reach the API server. Is the backend running?",
      0,
      "network_error",
    );
  }

  if (response.status === 401 && !path.endsWith("/auth/login")) {
    window.dispatchEvent(new Event("bee:unauthorized"));
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
  upload<T>(path: string, body: FormData): Promise<T> {
    return request<T>(path, { method: "POST", body });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
