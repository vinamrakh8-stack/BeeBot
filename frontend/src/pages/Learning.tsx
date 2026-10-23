import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { Conversation, LearningSet, Page } from "../types";

export default function Learning() {
  const [sets, setSets] = useState<LearningSet[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [selectedConversation, setSelectedConversation] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [setPage, conversationPage] = await Promise.all([
        api.get<Page<LearningSet>>("/api/learning?limit=50"),
        api.get<Page<Conversation>>("/api/conversations?limit=100").catch(() => null),
      ]);
      setSets(setPage.items);
      setConversations(conversationPage?.items ?? []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const created = await api.post<LearningSet>("/api/learning", {
        title: title.trim(),
        conversation_id: selectedConversation ? Number(selectedConversation) : undefined,
      });
      setSets((current) => [created, ...current]);
      setTitle("");
      setSelectedConversation("");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (loading && sets.length === 0) return <LoadingBlock label="Loading learning sets…" />;

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

      <Card
        title="Learning coach"
        subtitle="Turn a conversation into editable study notes, flashcards, and quizzes. Progress is stored in this app's database."
      >
        <form className="form-grid" onSubmit={create}>
          <label className="field grow">
            <span>Set title</span>
            <input
              type="text"
              value={title}
              maxLength={255}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Database indexing basics"
              required
            />
          </label>
          <label className="field">
            <span>Source conversation (optional)</span>
            <select
              value={selectedConversation}
              onChange={(event) => setSelectedConversation(event.target.value)}
            >
              <option value="">Manual set</option>
              {conversations.map((conversation) => (
                <option key={conversation.bee_id} value={conversation.id ?? conversation.bee_id}>
                  {conversation.short_summary ?? conversation.summary ?? `Conversation ${conversation.bee_id}`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button primary" disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create set"}
          </button>
        </form>
        <p className="muted small">
          Generation requires an AI provider. Manual cards and progress tracking work without
          one. Generated notes and cards are labelled and can be edited or deleted.
        </p>
      </Card>

      <Card title="Your learning sets">
        {sets.length === 0 ? (
          <EmptyState
            title="No learning sets yet"
            description="Create a set from a conversation or start a manual set, then add cards or generate material when an AI provider is configured."
          />
        ) : (
          <div className="list-stack">
            {sets.map((set) => (
              <article className="list-card" key={set.id}>
                <div className="list-card-head">
                  <span className="muted small">{formatDateTime(set.updated_at)}</span>
                  <Badge tone={set.ai_generated ? "warning" : "neutral"}>
                    {set.ai_generated ? "AI-generated notes" : "manual"}
                  </Badge>
                  <Badge tone="neutral">{set.item_count} items</Badge>
                </div>
                <Link to={`/learning/${set.id}`} className="list-card-title">
                  {set.title}
                </Link>
                <p className="muted small">
                  {set.notes
                    ? set.notes.slice(0, 220)
                    : "No notes yet. Open the set to add content or generate from its source."}
                </p>
                <div className="list-card-foot">
                  <span className="muted small">
                    {set.conversation_bee_id
                      ? `Source: conversation ${set.conversation_bee_id}`
                      : "Manual source"}
                  </span>
                  <Link to={`/learning/${set.id}`} className="button ghost small">
                    Open
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
