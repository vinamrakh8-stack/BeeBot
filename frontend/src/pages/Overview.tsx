import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import ActivityFeed from "../components/ActivityFeed";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, StatCard } from "../components/ui";
import { formatDateOnly, formatDateTime, relativeTime } from "../lib/format";
import { useReloadEffect } from "../store";
import type { Overview as OverviewData } from "../types";

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OverviewData>("/api/overview"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useReloadEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingBlock label="Loading your overview…" />;
  if (error && !data) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!data) return null;

  const isEmpty =
    data.counts.conversations === 0 &&
    data.counts.daily_summaries === 0 &&
    data.counts.facts === 0 &&
    data.counts.todos_open === 0 &&
    (data.counts.meetings ?? 0) === 0 &&
    (data.counts.learning_sets ?? 0) === 0;

  return (
    <div className="page-stack">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="stat-grid">
        <StatCard label="Conversations" value={data.counts.conversations} />
        <StatCard label="Daily summaries" value={data.counts.daily_summaries} />
        <StatCard label="Personal memories" value={data.counts.facts} />
        <StatCard
          label="Open tasks"
          value={data.counts.todos_open}
          hint={`${data.counts.todos_completed} completed`}
        />
        <StatCard label="Meetings" value={data.counts.meetings ?? 0} />
        <StatCard label="Learning sets" value={data.counts.learning_sets ?? 0} />
      </div>

      {isEmpty ? (
        <Card>
          <EmptyState
            title="No Bee data yet"
            description="Use “Sync now” to pull conversations, summaries, memories and tasks from Bee. If Bee is not connected, the sync shows the exact error instead of fake data."
            action={
              <Link to="/settings" className="button secondary">
                Check connection
              </Link>
            }
          />
        </Card>
      ) : null}

      <div className="grid-2">
        <Card
          title="Latest daily summary"
          subtitle={data.today_summary?.day ? formatDateOnly(data.today_summary.day) : undefined}
          actions={
            <Link to="/daily" className="button ghost small">
              All days
            </Link>
          }
        >
          {data.today_summary ? (
            <div className="prose">
              <p>{data.today_summary.short_summary ?? data.today_summary.summary ?? "No summary text."}</p>
              {data.today_summary.conversations_count != null ? (
                <p className="muted small">
                  {data.today_summary.conversations_count} conversations captured
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted">No daily summary has been synced yet.</p>
          )}
        </Card>

        <Card title="Sync status">
          <dl className="detail-list">
            <div>
              <dt>Last successful sync</dt>
              <dd title={formatDateTime(data.sync.last_synced_at)}>
                {relativeTime(data.sync.last_synced_at)}
              </dd>
            </div>
            <div>
              <dt>Last full sync</dt>
              <dd>{data.sync.last_full_sync_at ? relativeTime(data.sync.last_full_sync_at) : "—"}</dd>
            </div>
            <div>
              <dt>Incremental cursor</dt>
              <dd>{data.sync.cursor_present ? "Tracked" : "Not established"}</dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>
                {data.sync.last_run ? (
                  <Badge
                    tone={
                      data.sync.last_run.status === "success"
                        ? "success"
                        : data.sync.last_run.status === "failed"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {data.sync.last_run.status} · {data.sync.last_run.mode}
                  </Badge>
                ) : (
                  "Never run"
                )}
              </dd>
            </div>
          </dl>
          {data.sync.last_run?.error ? (
            <p className="form-error small">{data.sync.last_run.error}</p>
          ) : null}
          <Link to="/settings" className="button secondary">
            Connection settings
          </Link>
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="Recent conversations"
          actions={
            <Link to="/conversations" className="button ghost small">
              View all
            </Link>
          }
        >
          {data.recent_conversations.length === 0 ? (
            <p className="muted">No conversations synced yet.</p>
          ) : (
            <ul className="plain-list">
              {data.recent_conversations.map((conversation) => (
                <li key={conversation.bee_id}>
                  <Link to={`/conversations/${conversation.bee_id}`} className="list-link">
                    {conversation.short_summary ??
                      conversation.summary ??
                      `Conversation ${conversation.bee_id}`}
                  </Link>
                  <span className="muted small">{formatDateTime(conversation.start_time)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Open tasks"
          actions={
            <Link to="/tasks" className="button ghost small">
              All tasks
            </Link>
          }
        >
          {data.open_todos.length === 0 ? (
            <p className="muted">Nothing open. Nice.</p>
          ) : (
            <ul className="plain-list">
              {data.open_todos.map((todo) => (
                <li key={todo.bee_id}>
                  <span>{todo.text}</span>
                  <span className="muted small">
                    {todo.alarm_at ? `Reminder ${formatDateTime(todo.alarm_at)}` : "No reminder"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Recent memories">
          {data.recent_facts.length === 0 ? (
            <p className="muted">No memories learned yet.</p>
          ) : (
            <ul className="plain-list">
              {data.recent_facts.map((fact) => (
                <li key={fact.bee_id}>
                  <span>{fact.text}</span>
                  <Badge tone={fact.confirmed ? "success" : "warning"}>
                    {fact.confirmed ? "confirmed" : "pending"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity">
          <ActivityFeed items={data.recent_activity} />
        </Card>
      </div>
    </div>
  );
}
