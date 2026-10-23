import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api, errorMessage } from "../api";
import { useApp, useAuth } from "../store";
import type { SyncRun } from "../types";
import { Spinner } from "./States";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/chat", label: "AI chat" },
  { to: "/voice", label: "Voice assistant" },
  { to: "/conversations", label: "Conversations" },
  { to: "/daily", label: "Daily summaries" },
  { to: "/memory", label: "Personal memory" },
  { to: "/tasks", label: "Tasks & todos" },
  { to: "/meetings", label: "Meetings" },
  { to: "/learning", label: "Learning coach" },
  { to: "/insights", label: "Insights" },
  { to: "/graph", label: "Knowledge graph" },
  { to: "/search", label: "Search" },
  { to: "/activity", label: "Activity" },
  { to: "/settings", label: "Settings" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { live, refresh } = useApp();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const active = NAV.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );

  async function handleSync() {
    setSyncError(null);
    setSyncing(true);
    try {
      const run = await api.post<SyncRun>("/api/bee/sync");
      if (run.status === "failed") {
        setSyncError(run.error ?? "Sync failed.");
      } else {
        refresh();
      }
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside id="sidebar" className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Sections">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            <strong>Bee Voice+</strong>
            <span className="muted small">Personal context dashboard</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="muted small">Signed in as {user?.display_name ?? user?.username}</span>
          <button type="button" className="button ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <button
            type="button"
            className="button ghost menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>

          <h1 className="page-title">{active?.label ?? "Bee Voice+"}</h1>

          <div className="topbar-actions">
            <span className={`live-dot ${live}`} title={`Live updates: ${live}`}>
              <span className="dot" aria-hidden="true" />
              <span className="small muted">
                {live === "live" ? "Live" : live === "connecting" ? "Connecting" : "Offline"}
              </span>
            </span>

            <button
              type="button"
              className="button primary"
              onClick={() => void handleSync()}
              disabled={syncing}
            >
              {syncing ? <Spinner label="Syncing" /> : null}
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </header>

        {syncError ? (
          <div className="inline-alert" role="alert">
            {syncError}
            <button type="button" className="button ghost small" onClick={() => setSyncError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        <main id="main" className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
