import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { Conversation, Meeting, Page } from "../types";

export default function Meetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [title, setTitle] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualSummary, setManualSummary] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meetingPage, conversationPage] = await Promise.all([
        api.get<Page<Meeting>>("/api/meetings?limit=50"),
        api.get<Page<Conversation>>("/api/conversations?limit=100").catch(() => null),
      ]);
      setMeetings(meetingPage.items);
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

  async function createFromConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConversation) return;
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      const meeting = await api.post<Meeting>("/api/meetings", {
        conversation_id: Number(selectedConversation),
        title: title.trim() || undefined,
      });
      setMeetings((current) => [meeting, ...current]);
      setTitle("");
      setSelectedConversation("");
      setNotice("Meeting created from the conversation. Generate its summary next.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function createManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualTitle.trim()) return;
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      const meeting = await api.post<Meeting>("/api/meetings", {
        title: manualTitle.trim(),
        summary: manualSummary.trim() || undefined,
      });
      setMeetings((current) => [meeting, ...current]);
      setManualTitle("");
      setManualSummary("");
      setNotice("Manual meeting saved. No recording or transcription was performed.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  if (loading && meetings.length === 0) return <LoadingBlock label="Loading meetings…" />;

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
        </div>
      ) : null}

      <div className="grid-2">
        <Card
          title="Create from a conversation"
          subtitle="Uses an existing, authorized transcript or summary. The app does not record meetings."
        >
          <form className="form-stack" onSubmit={createFromConversation}>
            <label className="field">
              <span>Conversation</span>
              <select
                value={selectedConversation}
                onChange={(event) => setSelectedConversation(event.target.value)}
                required
              >
                <option value="">Select a stored conversation…</option>
                {conversations.map((conversation) => (
                  <option key={conversation.bee_id} value={conversation.id ?? conversation.bee_id}>
                    {conversation.short_summary ?? conversation.summary ?? `Conversation ${conversation.bee_id}`}
                  </option>
                ))}
              </select>
            </label>
            {conversations.length === 0 ? (
              <p className="muted small">
                No conversations are stored yet. Sync Bee or open a conversation first.
              </p>
            ) : null}
            <label className="field">
              <span>Title (optional)</span>
              <input
                type="text"
                value={title}
                maxLength={255}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Meeting title"
              />
            </label>
            <button type="submit" className="button primary" disabled={creating || !selectedConversation}>
              {creating ? "Creating…" : "Create meeting"}
            </button>
          </form>
        </Card>

        <Card title="Add a manual meeting" subtitle="Type notes yourself. No recording is implied.">
          <form className="form-stack" onSubmit={createManual}>
            <label className="field">
              <span>Title</span>
              <input
                type="text"
                value={manualTitle}
                maxLength={255}
                onChange={(event) => setManualTitle(event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Summary / notes</span>
              <textarea
                value={manualSummary}
                rows={4}
                maxLength={8000}
                onChange={(event) => setManualSummary(event.target.value)}
              />
            </label>
            <button type="submit" className="button secondary" disabled={creating || !manualTitle.trim()}>
              {creating ? "Saving…" : "Save manual meeting"}
            </button>
          </form>
        </Card>
      </div>

      <Card title="Meetings" subtitle="Summaries, decisions, and action items are linked to their source.">
        {meetings.length === 0 ? (
          <EmptyState
            title="No meetings yet"
            description="Create a meeting from an existing conversation, or add manual notes. A summary is generated only when an AI provider is configured."
          />
        ) : (
          <div className="list-stack">
            {meetings.map((meeting) => (
              <article className="list-card" key={meeting.id}>
                <div className="list-card-head">
                  <span className="muted small">{formatDateTime(meeting.meeting_at)}</span>
                  <Badge tone={meeting.ai_generated ? "warning" : "neutral"}>
                    {meeting.ai_generated ? "AI-generated summary" : "not generated"}
                  </Badge>
                  {meeting.source_kind === "conversation" ? (
                    <Badge tone="success">source conversation</Badge>
                  ) : (
                    <Badge tone="neutral">manual</Badge>
                  )}
                </div>
                <Link to={`/meetings/${meeting.id}`} className="list-card-title">
                  {meeting.title}
                </Link>
                <p className="muted small">{meeting.summary ?? "No summary yet."}</p>
                <div className="list-card-foot">
                  <span className="muted small">
                    {meeting.participants?.length
                      ? `Participants: ${meeting.participants.join(", ")}`
                      : "No participant data"}
                  </span>
                  <Link to={`/meetings/${meeting.id}`} className="button ghost small">
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
