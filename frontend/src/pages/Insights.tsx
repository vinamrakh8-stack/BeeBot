import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, StatCard } from "../components/ui";
import { formatDateOnly, formatDateTime } from "../lib/format";
import type { Insights, Todo } from "../types";

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function TaskRow({ task }: { task: Todo }) {
  return (
    <li>
      <span className={task.completed ? "muted" : ""}>{task.text}</span>
      <span className="muted small">
        {task.due_at
          ? `due ${formatDateTime(task.due_at)}`
          : task.completed
            ? "completed"
            : "no due date"}
      </span>
    </li>
  );
}

function RecordRow({ record }: { record: Record<string, unknown> }) {
  const text = asText(record.text) || asText(record.summary) || asText(record.label) || "Record";
  const route = asText(record.route);
  const due = asText(record.due_at);
  const meta = asText(record.meeting_title) || asText(record.meetingTitle) || asText(record.source);
  return (
    <li>
      {route ? <Link to={route}>{text}</Link> : <span>{text}</span>}
      <span className="muted small">
        {[meta, due ? `due ${formatDateTime(due)}` : ""].filter(Boolean).join(" · ")}
      </span>
    </li>
  );
}

export default function InsightsPage() {
  const [period, setPeriod] = useState<"day" | "week">("day");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ period, date });
      setData(await api.get<Insights>(`/api/insights?${query.toString()}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [period, date]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingBlock label="Building insights from stored records…" />;

  return (
    <div className="page-stack">
      <Card
        title="Daily and weekly insights"
        subtitle="Deterministic summaries of stored records. No productivity, health, or performance score is invented."
        actions={
          <div className="segmented" role="group" aria-label="Insight period">
            <button
              type="button"
              className={period === "day" ? "active" : ""}
              onClick={() => setPeriod("day")}
            >
              Day
            </button>
            <button
              type="button"
              className={period === "week" ? "active" : ""}
              onClick={() => setPeriod("week")}
            >
              Week
            </button>
          </div>
        }
      >
        <div className="form-grid">
          <label className="field">
            <span>Anchor date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {data ? (
          <p className="muted small">
            Window: {formatDateTime(data.start)} → {formatDateTime(data.end)} · generated{" "}
            {formatDateTime(data.generated_at)}
          </p>
        ) : null}
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {data && !data.sufficient_data ? (
        <EmptyState
          title="Not enough records for this period"
          description="There are no stored conversations, summaries, tasks, memories, meetings, or learning sets in this window. Sync Bee, change the date, or create local records. The app does not fill gaps with estimates."
        />
      ) : null}

      {data && data.sufficient_data ? (
        <>
          <div className="stat-grid">
            <StatCard label="Conversations" value={data.counts.conversations ?? 0} hint="in this window" />
            <StatCard label="Completed tasks" value={data.counts.completed_tasks ?? 0} hint="local update time" />
            <StatCard label="Pending tasks" value={data.counts.pending_tasks ?? 0} hint="all open tasks" />
            <StatCard label="Meetings" value={data.counts.meetings ?? 0} hint="in this window" />
            <StatCard label="Memories" value={data.counts.memories ?? 0} hint="created in window" />
            <StatCard label="Learning sets" value={data.counts.learning_sets ?? 0} hint="updated in window" />
          </div>

          <div className="grid-2">
            <Card title="Record-count trends" subtitle="Compared with the previous day or week.">
              <ul className="plain-list">
                {data.trends.map((trend) => (
                  <li key={trend.label}>
                    <span>{trend.label}</span>
                    <span>
                      <Badge
                        tone={
                          trend.direction === "up"
                            ? "success"
                            : trend.direction === "down"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {trend.current} now / {trend.previous} before
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small">{data.notes}</p>
            </Card>

            <Card title="Conversations" subtitle="Most recent records in this window.">
              {data.conversations.length === 0 ? (
                <p className="muted">No conversations in this window.</p>
              ) : (
                <ul className="plain-list">
                  {data.conversations.map((conversation) => (
                    <li key={conversation.bee_id}>
                      <Link to={`/conversations/${conversation.bee_id}`}>
                        {conversation.short_summary ?? conversation.summary ?? "Conversation"}
                      </Link>
                      <span className="muted small">{formatDateTime(conversation.start_time)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid-2">
            <Card title="Open and due tasks">
              {data.tasks.overdue.length > 0 ? (
                <>
                  <h3 className="section-subtitle">Overdue</h3>
                  <ul className="plain-list">
                    {data.tasks.overdue.map((task) => (
                      <TaskRow key={task.bee_id} task={task} />
                    ))}
                  </ul>
                </>
              ) : null}
              <h3 className="section-subtitle">Due within 7 days</h3>
              {data.tasks.due_soon.length === 0 ? (
                <p className="muted small">No dated tasks due in the next 7 days.</p>
              ) : (
                <ul className="plain-list">
                  {data.tasks.due_soon.map((task) => (
                    <TaskRow key={task.bee_id} task={task} />
                  ))}
                </ul>
              )}
              <h3 className="section-subtitle">Pending</h3>
              {data.tasks.pending.length === 0 ? (
                <p className="muted small">No pending tasks.</p>
              ) : (
                <ul className="plain-list">
                  {data.tasks.pending.slice(0, 10).map((task) => (
                    <TaskRow key={task.bee_id} task={task} />
                  ))}
                </ul>
              )}
              <Link to="/tasks" className="button ghost small">
                Open tasks
              </Link>
            </Card>

            <Card title="Decisions and commitments">
              <h3 className="section-subtitle">Decisions</h3>
              {data.decisions.length === 0 ? (
                <p className="muted small">No decisions recorded in meetings for this window.</p>
              ) : (
                <ul className="plain-list">
                  {data.decisions.map((record, index) => (
                    <RecordRow key={`decision-${index}`} record={record} />
                  ))}
                </ul>
              )}
              <h3 className="section-subtitle">Commitments</h3>
              {data.commitments.length === 0 ? (
                <p className="muted small">No commitments with dates or meeting action items.</p>
              ) : (
                <ul className="plain-list">
                  {data.commitments.map((record, index) => (
                    <RecordRow key={`commitment-${index}`} record={record} />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid-2">
            <Card title="Completed tasks" subtitle="Completion time is the local record update time.">
              {data.tasks.completed.length === 0 ? (
                <p className="muted">No completions recorded in this window.</p>
              ) : (
                <ul className="plain-list">
                  {data.tasks.completed.map((task) => (
                    <TaskRow key={task.bee_id} task={task} />
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Tag activity" subtitle="Tags attached to memories created in this window. These are not inferred projects.">
              {data.project_activity.length === 0 ? (
                <p className="muted">No tagged memories in this window.</p>
              ) : (
                <ul className="plain-list">
                  {data.project_activity.map((entry) => {
                    const tag = asText(entry.tag);
                    const count = asNumber(entry.count) ?? 0;
                    return (
                      <li key={tag}>
                        <span>{tag}</span>
                        <Badge tone="neutral">{count}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {data.recent_summaries.length > 0 ? (
            <Card title="Daily summaries in this window">
              <ul className="plain-list">
                {data.recent_summaries.map((summary) => (
                  <li key={summary.bee_id}>
                    <Link to="/daily">{formatDateOnly(summary.day)}</Link>
                    <span className="muted small">
                      {summary.short_summary ?? summary.summary ?? "Summary"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
