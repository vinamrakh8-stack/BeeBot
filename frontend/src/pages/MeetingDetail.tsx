import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, MetaRow } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { Meeting } from "../types";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function MeetingDetail() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [decisions, setDecisions] = useState("");
  const [actions, setActions] = useState("");

  const load = useCallback(async () => {
    if (!meetingId) return;
    setLoading(true);
    setError(null);
    try {
      const value = await api.get<Meeting>(`/api/meetings/${meetingId}`);
      setMeeting(value);
      setSummary(value.summary ?? "");
      setKeyPoints((value.key_points ?? []).join("\n"));
      setDecisions((value.decisions ?? []).join("\n"));
      setActions(
        (value.action_items ?? [])
          .map((item) => `${item.text}${item.due_at ? ` | ${item.due_at}` : ""}`)
          .join("\n"),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!meetingId) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const value = await api.post<Meeting>(`/api/meetings/${meetingId}/generate`);
      setMeeting(value);
      setSummary(value.summary ?? "");
      setKeyPoints((value.key_points ?? []).join("\n"));
      setDecisions((value.decisions ?? []).join("\n"));
      setActions(
        (value.action_items ?? [])
          .map((item) => `${item.text}${item.due_at ? ` | ${item.due_at}` : ""}`)
          .join("\n"),
      );
      setNotice("Summary generated from the linked conversation.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!meetingId) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const actionItems = linesToArray(actions).map((line) => {
        const [text, due] = line.split("|").map((part) => part.trim());
        return { text, due_at: due || null };
      });
      const value = await api.patch<Meeting>(`/api/meetings/${meetingId}`, {
        summary: summary.trim() || null,
        key_points: linesToArray(keyPoints),
        decisions: linesToArray(decisions),
        action_items: actionItems,
      });
      setMeeting(value);
      setNotice("Meeting notes saved.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!meetingId) return;
    if (!window.confirm("Delete this meeting summary? The source conversation is not modified.")) {
      return;
    }
    setBusy(true);
    try {
      await api.del(`/api/meetings/${meetingId}`);
      navigate("/meetings");
    } catch (caught) {
      setActionError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (loading && !meeting) return <LoadingBlock label="Loading meeting…" />;
  if (error && !meeting) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!meeting) return null;

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Link to="/meetings" className="button ghost small">
          ← All meetings
        </Link>
        <div className="card-actions">
          <button type="button" className="button primary" onClick={() => void generate()} disabled={busy}>
            {busy ? "Working…" : "Generate summary"}
          </button>
          <button type="button" className="button danger" onClick={() => void remove()} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

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

      <Card
        title={meeting.title}
        subtitle={formatDateTime(meeting.meeting_at)}
        actions={
          <Badge tone={meeting.ai_generated ? "warning" : "neutral"}>
            {meeting.ai_generated ? "AI-generated summary" : "not generated"}
          </Badge>
        }
      >
        <MetaRow label="Source">
          {meeting.conversation_bee_id ? (
            <Link to={`/conversations/${meeting.conversation_bee_id}`}>
              Conversation {meeting.conversation_bee_id}
            </Link>
          ) : (
            "Manual meeting (no transcript)"
          )}
        </MetaRow>
        <MetaRow label="Participants">
          {meeting.participants?.length ? meeting.participants.join(", ") : "No participant data"}
        </MetaRow>
        <p className="muted small">
          This summary uses an existing authorized conversation. The app does not record
          meetings or claim that Bee records them.
        </p>
        <p className="muted small">
          Generation requires a configured AI provider; without one, the request fails with a
          visible configuration message instead of a fabricated summary.
        </p>
      </Card>

      <Card title="Editable notes" subtitle="Generated content is separate from the source and can be corrected.">
        <form className="form-stack" onSubmit={save}>
          <label className="field">
            <span>Summary</span>
            <textarea value={summary} rows={6} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <label className="field">
            <span>Key discussion points (one per line)</span>
            <textarea value={keyPoints} rows={4} onChange={(event) => setKeyPoints(event.target.value)} />
          </label>
          <label className="field">
            <span>Decisions (one per line)</span>
            <textarea value={decisions} rows={3} onChange={(event) => setDecisions(event.target.value)} />
          </label>
          <label className="field">
            <span>Action items (one per line; optional “| ISO due date”)</span>
            <textarea value={actions} rows={4} onChange={(event) => setActions(event.target.value)} />
          </label>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save notes"}
          </button>
        </form>
      </Card>
    </div>
  );
}
