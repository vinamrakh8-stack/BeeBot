import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { User } from "./types";

type LiveStatus = "connecting" | "live" | "offline";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface AppContextValue {
  version: number;
  refresh: () => void;
  live: LiveStatus;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AppContext = createContext<AppContextValue | null>(null);

const LIVE_EVENTS = [
  "new-conversation",
  "update-conversation",
  "update-conversation-summary",
  "delete-conversation",
  "todo-created",
  "todo-updated",
  "todo-deleted",
  "journal-created",
  "journal-updated",
];

export function AppProviders({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState<LiveStatus>("offline");
  const debounceRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<User>("/api/auth/me")
      .then((current) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("bee:unauthorized", onUnauthorized);
    return () => window.removeEventListener("bee:unauthorized", onUnauthorized);
  }, []);

  // Bee's documented SSE stream. Events are treated as a hint to refetch.
  useEffect(() => {
    if (!user) {
      setLive("offline");
      return;
    }

    let source: EventSource | null = null;
    const schedule = () => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        setVersion((current) => current + 1);
      }, 1500);
    };

    try {
      setLive("connecting");
      source = new EventSource("/api/stream");
      source.onopen = () => setLive("live");
      source.onerror = () => setLive("offline");
      for (const name of LIVE_EVENTS) {
        source.addEventListener(name, schedule);
      }
    } catch {
      setLive("offline");
    }

    return () => {
      window.clearTimeout(debounceRef.current);
      source?.close();
    };
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    const current = await api.post<User>("/api/auth/login", { username, password });
    setUser(current);
    setVersion((value) => value + 1);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  const authValue = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );
  const appValue = useMemo<AppContextValue>(
    () => ({ version, refresh, live }),
    [version, refresh, live],
  );

  return (
    <AuthContext.Provider value={authValue}>
      <AppContext.Provider value={appValue}>{children}</AppContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AppProviders");
  return context;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProviders");
  return context;
}

/** Run a loader on mount and whenever the app refresh token changes. */
export function useReloadEffect(callback: () => void, deps: unknown[]) {
  const { version } = useApp();
  useEffect(() => {
    callback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
}
