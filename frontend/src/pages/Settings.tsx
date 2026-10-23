import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, MetaRow } from "../components/ui";
import { formatDateTime, relativeTime, titleCase } from "../lib/format";
import { useApp, useReloadEffect } from "../store";
import type { AssistantStatus, Connection, DeleteResult, PrivacySummary, SyncRun } from "../types";

export default function Settings() {
  const { live, refresh } = useApp();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [assistant, setAssistant] = useState<AssistantStatus | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [privacy, setPrivacy] = useState<PrivacySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextConnection, nextRuns, nextPrivacy] = await Promise.all([
        api.get<Connection>("/api/bee/status"),
        api.get<SyncRun[]>("/api/sync/runs?limit=8"),
        api.get<PrivacySummary>("/api/settings/privacy"),
      ]);
      setConnection(nextConnection);
      setRuns(nextRuns);
      setPrivacy(nextPrivacy);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useReloadEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AssistantStatus>("/api/assistant/status")
      .then((value) => {
        if (!cancelled) setAssistant(value);
      })
      .catch(() => {
        // The AI card is supplemental; a status failure must not hide the Bee
        // connection and sync controls.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSync(full: boolean) {
    if (
      full &&
      !window.confirm("Full re-sync re-downloads every entity and can take a while. Continue?")
    ) {
      return;
    }
    setSyncing(true);
    setActionError(null);
    setNotice(null);
    try {
      const run = await api.post<SyncRun>(`/api/bee/sync?full=${full ? "true" : "false"}`);
      if (run.status === "failed") {
        setActionError(run.error ?? "Sync failed.");
      } else {
        setNotice("Sync completed.");
        refresh();
      }
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }

  async function exportData() {
    setExporting(true);
    setActionError(null);
    setNotice(null);
    try {
      const payload = await api.get<Record<string, unknown>>("/api/data/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bee-voice-plus-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("Export downloaded. It contains only this account's local records.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  async function deleteData() {
    if (
      !window.confirm(
        "Delete all local copies of Bee data from this app? Bee itself is not modified and you can sync again.",
      )
    ) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await api.del<DeleteResult>("/api/data");
      setNotice(result.message);
      refresh();
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !connection) return <LoadingBlock label="Checking connection…" />;

  return (
    <div className="page-stack">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {actionError ? (
        <div className="inline-alert" role="alert">
          {actionError}
          <button type="button" className="button ghost small" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="inline-alert success" role="status">
          {notice}
          <button type="button" className="button ghost small" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <Card
        title="Bee connection"
        subtitle="Credentials are held on the server and never sent to the browser."
      >
        {connection ? (
          <>
            <div className="badge-row">
              <Badge tone={connection.configured ? "success" : "danger"}>
                {connection.configured ? "configured" : "not configured"}
              </Badge>
              <Badge tone={connection.reachable ? "success" : "warning"}>
                {connection.reachable ? "reachable" : "unreachable"}
              </Badge>
              <Badge tone="neutral">mode: {connection.mode}</Badge>
            </div>

            <MetaRow label="API base">{connection.base_url}</MetaRow>
            <MetaRow label="Live updates">
              <Badge
                tone={live === "live" ? "success" : live === "connecting" ? "warning" : "neutral"}
              >
                {titleCase(live)}
              </Badge>
            </MetaRow>

            {connection.error ? (
              <p className="form-error" role="alert">
                {connection.error}
              </p>
            ) : null}

            {connection.account ? (
              <div className="account-block">
                <h3>Connected account</h3>
                <dl className="detail-list">
                  {Object.entries(connection.account).map(([key, value]) => (
                    <div key={key}>
                      <dt>{titleCase(key)}</dt>
                      <dd>{value === null ? "—" : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>

      {assistant ? (
        <Card
          title="AI and voice"
          subtitle="Keys and base URLs stay on the server. The browser receives status only."
        >
          <div className="badge-row">
            <Badge tone={assistant.configured ? "success" : "warning"}>
              {assistant.configured ? "AI provider configured" : "AI provider not configured"}
            </Badge>
            <Badge tone="neutral">provider: {assistant.provider}</Badge>
            <Badge tone={assistant.wake_word.available ? "warning" : "neutral"}>
              wake word: {assistant.wake_word.available ? "available" : "unavailable"}
            </Badge>
          </div>
          <MetaRow label="Chat model">{assistant.model}</MetaRow>
          <MetaRow label="Speech-to-text">{assistant.stt_model}</MetaRow>
          <MetaRow label="Text-to-speech">{assistant.tts_model}</MetaRow>
          <MetaRow label="API base">{assistant.base_url || "not set"}</MetaRow>
          <MetaRow label="Rate limit">
            {assistant.rate_limit_per_minute} AI requests per minute per operator
          </MetaRow>
          <MetaRow label="Retrieval">
            {assistant.retrieval.mode} · embeddings {assistant.retrieval.embeddings ? "on" : "off"}
          </MetaRow>
          <p className="muted small">{assistant.retrieval.note}</p>
          <p className="muted small">
            Wake word: {assistant.wake_word.phrase}. Engine reported as{" "}
            <code>{assistant.wake_word.engine}</code>. A local wake-word engine is not bundled;
            continuous cloud audio detection is intentionally disabled. Push-to-talk is the
            reliable interaction in a web tab.
          </p>
          <p className="muted small">
            Configure with <code>AI_API_KEY</code>, <code>AI_BASE_URL</code>,{" "}
            <code>AI_MODEL</code>, <code>AI_STT_MODEL</code>, <code>AI_TTS_MODEL</code>, and{" "}
            <code>AI_TTS_VOICE</code>. Changing these requires a server restart.
          </p>
        </Card>
      ) : null}

      <Card
        title="Synchronisation"
        subtitle="Incremental sync uses Bee's change feed. Cursors older than 7 days fall back to a full sync automatically."
        actions={
          <div className="card-actions">
            <button
              type="button"
              className="button secondary"
              disabled={syncing}
              onClick={() => void runSync(false)}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              className="button ghost"
              disabled={syncing}
              onClick={() => void runSync(true)}
            >
              Full re-sync
            </button>
          </div>
        }
      >
        {connection ? (
          <dl className="detail-list">
            <div>
              <dt>Last successful sync</dt>
              <dd title={formatDateTime(connection.sync.last_synced_at)}>
                {connection.sync.last_synced_at
                  ? `${relativeTime(connection.sync.last_synced_at)} (${formatDateTime(
                      connection.sync.last_synced_at,
                    )})`
                  : "never"}
              </dd>
            </div>
            <div>
              <dt>Last full sync</dt>
              <dd>{formatDateTime(connection.sync.last_full_sync_at)}</dd>
            </div>
            <div>
              <dt>Cursor</dt>
              <dd>{connection.sync.cursor_present ? "tracked" : "not established"}</dd>
            </div>
            <div>
              <dt>Running</dt>
              <dd>{connection.sync.running ? "yes" : "no"}</dd>
            </div>
          </dl>
        ) : null}

        {runs.length === 0 ? (
          <p className="muted">No sync has run yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Recent synchronisation runs</caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Trigger</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Status</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.started_at)}</td>
                    <td>{run.trigger}</td>
                    <td>{run.mode}</td>
                    <td>
                      <Badge
                        tone={
                          run.status === "success"
                            ? "success"
                            : run.status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td>
                      {run.error ? (
                        <span className="form-error small">{run.error}</span>
                      ) : run.counts ? (
                        <span className="muted small">
                          {Object.entries(run.counts)
                            .map(([entity, outcomes]) => {
                              const inserted = outcomes.inserted ?? 0;
                              const updated = outcomes.updated ?? 0;
                              return `${entity}: +${inserted} ~${updated}`;
                            })
                            .join(", ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Privacy and data retention">
        {privacy ? (
          <>
            <dl className="detail-list">
              {Object.entries(privacy.stored).map(([key, value]) => (
                <div key={key}>
                  <dt>{titleCase(key)} stored locally</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="muted small">{privacy.retention}</p>
            <p className="muted small">{privacy.credentials}</p>
            <p className="muted small">Search and sync cover: {privacy.sources.join(", ")}.</p>

            <div className="privacy-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => void exportData()}
                disabled={exporting}
              >
                {exporting ? "Exporting…" : "Export my data"}
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void deleteData()}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete local data"}
              </button>
              <span className="muted small">
                To disconnect Bee entirely, remove <code>BEE_TOKEN</code> from the server
                environment (or stop <code>bee proxy</code>) and restart the app.
              </span>
            </div>
          </>
        ) : (
          <p className="muted">Privacy details unavailable.</p>
        )}
      </Card>

      <Card title="Requirements checklist">
        <ul className="plain-list">
          <li>
            <span>Bee iOS app with Developer Mode unlocked (tap Version 5×)</span>
            <Badge tone="neutral">manual</Badge>
          </li>
          <li>
            <span>
              <code>BEE_TOKEN</code> set on the server, or <code>bee proxy</code> running
            </span>
            <Badge tone={connection?.configured ? "success" : "danger"}>
              {connection?.configured ? "done" : "missing"}
            </Badge>
          </li>
          <li>
            <span>
              Dashboard operator account (<code>APP_PASSWORD_HASH</code>)
            </span>
            <Badge tone="success">done</Badge>
          </li>
          <li>
            <span>Database migrated with Alembic</span>
            <Badge tone="neutral">deployment step</Badge>
          </li>
        </ul>
      </Card>
    </div>
  );
}
