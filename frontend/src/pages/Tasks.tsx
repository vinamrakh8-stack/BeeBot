import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import Pagination from "../components/Pagination";
import { EmptyState, ErrorBanner, LoadingBlock, Spinner } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useReloadEffect } from "../store";
import type { ExtractCandidate, Page, Todo } from "../types";

const LIMIT = 25;
type StatusFilter = "all" | "open" | "completed";
type PermissionState = "unsupported" | "default" | "granted" | "denied";

function toInputValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromInputValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function originTone(origin?: string) {
  if (origin === "bee") return "success" as const;
  if (origin === "ai") return "warning" as const;
  return "neutral" as const;
}

export default function Tasks() {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [origin, setOrigin] = useState<"all" | "bee" | "user" | "ai">("all");
  const [data, setData] = useState<Page<Todo> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newConversation, setNewConversation] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editDue, setEditDue] = useState("");
  const [extractConversation, setExtractConversation] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState<ExtractCandidate[]>([]);
  const [candidateSource, setCandidateSource] = useState<number | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unsupported");

  useEffect(() => {
    setOffset(0);
  }, [status, origin]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission as PermissionState);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
        status,
      });
      if (origin !== "all") params.set("origin", origin);
      setData(await api.get<Page<Todo>>(`/api/tasks?${params.toString()}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [offset, status, origin]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (permission !== "granted" || typeof window === "undefined" || !data) return;
    const timers: number[] = [];
    const now = Date.now();
    for (const todo of data.items) {
      if (todo.completed || !todo.due_at) continue;
      const when = new Date(todo.due_at).getTime();
      if (Number.isNaN(when) || when <= now || when - now > 24 * 60 * 60 * 1000) continue;
      const timer = window.setTimeout(() => {
        if (Notification.permission === "granted") {
          new Notification("Bee Voice+ task reminder", { body: todo.text });
        }
      }, when - now);
      timers.push(timer);
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [data, permission]);

  async function toggle(todo: Todo) {
    setPendingId(todo.bee_id);
    setActionError(null);
    try {
      const updated = await api.patch<Todo>(`/api/tasks/${todo.bee_id}`, {
        completed: !todo.completed,
      });
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.bee_id === updated.bee_id ? updated : item,
              ),
            }
          : current,
      );
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newText.trim()) return;
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      await api.post<Todo>("/api/tasks", {
        text: newText.trim(),
        due_at: fromInputValue(newDue),
        source_bee_id: /^\d+$/.test(newConversation.trim())
          ? Number(newConversation.trim())
          : undefined,
      });
      setNewText("");
      setNewDue("");
      setNewConversation("");
      setNotice("Local task created. It is not sent to Bee.");
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(todo: Todo) {
    setEditingId(todo.bee_id);
    setEditText(todo.text);
    setEditDue(toInputValue(todo.due_at));
    setActionError(null);
  }

  async function saveEdit(todo: Todo) {
    setPendingId(todo.bee_id);
    setActionError(null);
    setNotice(null);
    try {
      await api.patch<Todo>(`/api/tasks/${todo.bee_id}`, {
        text: editText.trim(),
        due_at: fromInputValue(editDue),
      });
      setEditingId(null);
      setNotice(
        todo.bee_id > 0
          ? "Task edited locally. A tombstone prevents sync from overwriting it."
          : "Task updated.",
      );
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  }

  async function postpone(todo: Todo) {
    const base = todo.due_at ? new Date(todo.due_at) : new Date();
    if (Number.isNaN(base.getTime())) base.setTime(Date.now());
    const next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    setPendingId(todo.bee_id);
    setActionError(null);
    try {
      await api.patch<Todo>(`/api/tasks/${todo.bee_id}`, {
        postponed_until: next.toISOString(),
        due_at: next.toISOString(),
      });
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(todo: Todo) {
    if (!window.confirm("Delete this task? The source conversation is not modified.")) return;
    setPendingId(todo.bee_id);
    setActionError(null);
    try {
      await api.del(`/api/tasks/${todo.bee_id}`);
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setPendingId(null);
    }
  }

  async function extract() {
    const value = extractConversation.trim();
    if (!/^\d+$/.test(value)) {
      setActionError("Enter the numeric Bee conversation id shown in a conversation URL.");
      return;
    }
    setExtracting(true);
    setActionError(null);
    setNotice(null);
    setCandidates([]);
    try {
      const response = await api.post<{
        candidates: ExtractCandidate[];
        source: { conversation_id: number; bee_id: number };
      }>("/api/tasks/extract", { bee_id: Number(value) });
      setCandidates(response.candidates);
      setCandidateSource(response.source.conversation_id);
      if (response.candidates.length === 0) {
        setNotice("The model found no tasks supported by that conversation.");
      }
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setExtracting(false);
    }
  }

  async function saveCandidate(candidate: ExtractCandidate) {
    setActionError(null);
    setNotice(null);
    try {
      await api.post<Todo>("/api/tasks", {
        text: candidate.text,
        due_at: candidate.due_at ?? null,
        source_bee_id: candidate.conversation_bee_id ?? undefined,
        source_conversation_id:
          candidate.conversation_bee_id == null
            ? candidate.source_conversation_id ?? candidateSource ?? undefined
            : undefined,
        source_excerpt: candidate.excerpt ?? undefined,
        origin: "ai",
      });
      setCandidates((current) => current.filter((item) => item.text !== candidate.text));
      setNotice("Task saved locally. It is not sent to Bee.");
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function requestNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
    } catch {
      setPermission("denied");
    }
  }

  return (
    <div className="page-stack">
      <Card title="Add a task" subtitle="Local tasks stay in this app. Completing a Bee task still writes through to Bee.">
        <form className="form-grid" onSubmit={createTask}>
          <label className="field grow">
            <span>Task</span>
            <input
              type="text"
              value={newText}
              maxLength={1000}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="What needs to happen?"
              required
            />
          </label>
          <label className="field">
            <span>Due (optional)</span>
            <input
              type="datetime-local"
              value={newDue}
              onChange={(event) => setNewDue(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Source Bee conversation id (optional)</span>
            <input
              type="text"
              inputMode="numeric"
              value={newConversation}
              onChange={(event) => setNewConversation(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <button type="submit" className="button primary" disabled={creating || !newText.trim()}>
            {creating ? "Saving…" : "Add task"}
          </button>
        </form>
      </Card>

      <Card
        title="Extract tasks from a conversation"
        subtitle="AI proposes candidates and deadlines only when stated. Nothing is saved until you approve it."
      >
        <div className="form-grid">
          <label className="field">
            <span>Bee conversation id</span>
            <input
              type="text"
              inputMode="numeric"
              value={extractConversation}
              onChange={(event) => setExtractConversation(event.target.value)}
              placeholder="e.g. 42"
            />
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={() => void extract()}
            disabled={extracting}
          >
            {extracting ? "Extracting…" : "Extract candidates"}
          </button>
        </div>
        <p className="muted small">
          Duplicate tasks with the same source and normalized text are detected. Extraction
          requires an AI provider and never fabricates a deadline.
        </p>
        {candidates.length > 0 ? (
          <div className="list-stack">
            {candidates.map((candidate, index) => (
              <article className="list-card" key={`${candidate.text}-${index}`}>
                <div className="list-card-head">
                  <Badge tone="warning">AI candidate</Badge>
                  {candidate.duplicate ? <Badge tone="warning">possible duplicate</Badge> : null}
                  <Badge tone="neutral">{Math.round(candidate.confidence * 100)}% confidence</Badge>
                </div>
                <p>{candidate.text}</p>
                <p className="muted small">
                  {candidate.due_at ? `Due ${formatDateTime(candidate.due_at)}` : "No deadline stated"}
                </p>
                {candidate.excerpt ? (
                  <p className="muted small">Source excerpt: “{candidate.excerpt}”</p>
                ) : null}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void saveCandidate(candidate)}
                >
                  Save task
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Filter tasks">
            {(["open", "completed", "all"] as StatusFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`segment ${status === value ? "active" : ""}`}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "open" ? "Open" : value === "completed" ? "Completed" : "All"}
              </button>
            ))}
          </div>
          <label className="field inline">
            <span>Origin</span>
            <select
              value={origin}
              onChange={(event) => setOrigin(event.target.value as "all" | "bee" | "user" | "ai")}
            >
              <option value="all">All origins</option>
              <option value="bee">From Bee</option>
              <option value="user">Local / edited</option>
              <option value="ai">AI-suggested</option>
            </select>
          </label>
          <span className="muted small">
            Bee task completion is written to Bee first, then mirrored here. Local tasks never
            claim to be Bee data.
          </span>
        </div>
      </Card>

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
        </div>
      ) : null}
      {loading && !data ? <LoadingBlock label="Loading tasks…" /> : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={status === "completed" ? "Nothing completed yet" : "No tasks"}
            description="Bee extracts tasks from your conversations. Run a sync to pull them in."
          />
        </Card>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="list-stack">
          <ul className="task-list">
            {data.items.map((todo) => {
              const busy = pendingId === todo.bee_id;
              return (
                <li key={todo.bee_id} className={`task ${todo.completed ? "done" : ""}`}>
                  {editingId === todo.bee_id ? (
                    <div className="task-edit form-stack">
                      <label className="field">
                        <span>Task</span>
                        <input
                          type="text"
                          value={editText}
                          maxLength={1000}
                          onChange={(event) => setEditText(event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Due</span>
                        <input
                          type="datetime-local"
                          value={editDue}
                          onChange={(event) => setEditDue(event.target.value)}
                        />
                      </label>
                      <div className="card-actions">
                        <button
                          type="button"
                          className="button primary small"
                          onClick={() => void saveEdit(todo)}
                          disabled={busy || !editText.trim()}
                        >
                          Save
                        </button>
                        <button type="button" className="button ghost small" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="task-check">
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        disabled={busy}
                        onChange={() => void toggle(todo)}
                        aria-label={`Mark "${todo.text}" as ${todo.completed ? "open" : "completed"}`}
                      />
                      <span className="task-text">{todo.text}</span>
                    </label>
                  )}

                  <div className="task-meta">
                    {busy ? <Spinner label="Saving" /> : null}
                    <Badge tone={originTone(todo.origin)}>
                      {todo.origin === "bee"
                        ? "from Bee"
                        : todo.origin === "ai"
                          ? "AI-suggested"
                          : "local"}
                    </Badge>
                    {todo.due_at ? <Badge tone="warning">Due {formatDateTime(todo.due_at)}</Badge> : null}
                    {todo.postponed_until ? (
                      <Badge tone="neutral">Postponed to {formatDateTime(todo.postponed_until)}</Badge>
                    ) : null}
                    {todo.alarm_at ? (
                      <Badge tone="warning">Reminder {formatDateTime(todo.alarm_at)}</Badge>
                    ) : null}
                    <span className="muted small">
                      Created {formatDateTime(todo.bee_created_at ?? todo.created_at)}
                    </span>
                    {todo.source_conversation_bee_id ? (
                      <Link
                        to={`/conversations/${todo.source_conversation_bee_id}`}
                        className="small"
                      >
                        Source conversation
                      </Link>
                    ) : null}
                    {editingId !== todo.bee_id ? (
                      <span className="edge-actions">
                        <button type="button" className="button ghost small" onClick={() => startEdit(todo)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => void postpone(todo)}
                          disabled={busy}
                        >
                          +1 day
                        </button>
                        <button
                          type="button"
                          className="button danger small"
                          onClick={() => void remove(todo)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <Pagination
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={setOffset}
          />
        </div>
      ) : null}

      <Card title="Reminders" subtitle="Browser notifications are optional and foreground-only.">
        <div className="toolbar">
          <Badge tone={permission === "granted" ? "success" : "warning"}>
            notification permission: {permission}
          </Badge>
          <button
            type="button"
            className="button secondary small"
            onClick={() => void requestNotifications()}
            disabled={permission === "unsupported"}
          >
            Enable browser reminders
          </button>
        </div>
        <p className="muted small">
          When granted, reminders fire only while this dashboard tab is open and the task is due
          within 24 hours. There is no background push service, and this app does not claim one.
        </p>
      </Card>
    </div>
  );
}
