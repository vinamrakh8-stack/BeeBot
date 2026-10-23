import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, MetaRow } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { LearningDetail, LearningItem } from "../types";

function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function LearningDetailPage() {
  const { setId } = useParams<{ setId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LearningDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [goals, setGoals] = useState("");
  const [revisionPlan, setRevisionPlan] = useState("");
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [kind, setKind] = useState<"flashcard" | "quiz">("flashcard");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");

  const apply = useCallback((value: LearningDetail) => {
    setDetail(value);
    setNotes(value.notes ?? "");
    setGoals((value.goals ?? []).join("\n"));
    setRevisionPlan((value.revision_plan ?? []).join("\n"));
  }, []);

  const load = useCallback(async () => {
    if (!setId) return;
    setLoading(true);
    setError(null);
    try {
      apply(await api.get<LearningDetail>(`/api/learning/${setId}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [setId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    if (!setId) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      apply(await api.post<LearningDetail>(`/api/learning/${setId}/generate`));
      setNotice(
        "Study material generated from the source conversation. Previous AI-generated cards were replaced; your manual cards were kept.",
      );
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setId) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      apply(
        await api.patch<LearningDetail>(`/api/learning/${setId}`, {
          notes: notes.trim() || null,
          goals: linesToArray(goals),
          revision_plan: linesToArray(revisionPlan),
        }),
      );
      setNotice("Notes, goals, and revision plan saved.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setId || !question.trim() || !answer.trim()) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await api.post<LearningItem>(`/api/learning/${setId}/items`, {
        kind,
        question: question.trim(),
        answer: answer.trim(),
        explanation: explanation.trim() || undefined,
      });
      setQuestion("");
      setAnswer("");
      setExplanation("");
      apply(await api.get<LearningDetail>(`/api/learning/${setId}`));
      setNotice("Manual card added.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function progress(item: LearningItem, status: "review" | "mastered") {
    setBusy(true);
    setActionError(null);
    try {
      await api.patch<LearningItem>(`/api/learning/items/${item.id}`, {
        status,
        reviews: item.reviews + 1,
      });
      if (setId) apply(await api.get<LearningDetail>(`/api/learning/${setId}`));
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: LearningItem) {
    if (!window.confirm("Delete this card?")) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.del(`/api/learning/items/${item.id}`);
      if (setId) apply(await api.get<LearningDetail>(`/api/learning/${setId}`));
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeSet() {
    if (!setId) return;
    if (
      !window.confirm(
        "Delete this learning set? Cards and progress will be removed from the app. The source conversation is not modified.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.del(`/api/learning/${setId}`);
      navigate("/learning");
    } catch (caught) {
      setActionError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (loading && !detail) return <LoadingBlock label="Loading learning set…" />;
  if (error && !detail) return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!detail) return null;

  const mastered = detail.items.filter((item) => item.status === "mastered").length;
  const reviewed = detail.items.filter((item) => item.reviews > 0).length;

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Link to="/learning" className="button ghost small">
          ← All learning sets
        </Link>
        <div className="card-actions">
          <button type="button" className="button primary" onClick={() => void generate()} disabled={busy}>
            {busy ? "Working…" : "Generate from source"}
          </button>
          <button type="button" className="button danger" onClick={() => void removeSet()} disabled={busy}>
            Delete set
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
        title={detail.title}
        subtitle={formatDateTime(detail.updated_at)}
        actions={
          <div className="badge-row">
            <Badge tone={detail.ai_generated ? "warning" : "neutral"}>
              {detail.ai_generated ? "AI-generated notes" : "clean/manual"}
            </Badge>
            <Badge tone="neutral">{detail.item_count} cards</Badge>
          </div>
        }
      >
        <MetaRow label="Source">
          {detail.conversation_bee_id ? (
            <Link to={`/conversations/${detail.conversation_bee_id}`}>
              Conversation {detail.conversation_bee_id}
            </Link>
          ) : (
            "Manual learning set"
          )}
        </MetaRow>
        <MetaRow label="Progress">
          {mastered} mastered · {reviewed} reviewed · {detail.items.length} total
        </MetaRow>
        <p className="muted small">
          Generated content is stored separately from the source and is labelled. The source
          conversation is never modified. Generation requires a configured AI provider.
        </p>
      </Card>

      <Card title="Study notes and goals">
        <form className="form-stack" onSubmit={saveNotes}>
          <label className="field">
            <span>Notes</span>
            <textarea value={notes} rows={8} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <label className="field">
            <span>Goals (one per line)</span>
            <textarea value={goals} rows={4} onChange={(event) => setGoals(event.target.value)} />
          </label>
          <label className="field">
            <span>Revision plan (one step per line)</span>
            <textarea
              value={revisionPlan}
              rows={4}
              onChange={(event) => setRevisionPlan(event.target.value)}
              placeholder="Day 1: review the notes (20 minutes)"
            />
          </label>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save notes"}
          </button>
        </form>
      </Card>

      <Card title="Cards" subtitle="Answers start hidden so you can test yourself.">
        {detail.items.length === 0 ? (
          <EmptyState
            title="No cards yet"
            description="Generate from a source conversation or add a flashcard below. Cards can be reviewed without any cloud service."
          />
        ) : (
          <div className="list-stack">
            {detail.items.map((item) => (
              <article className="list-card study-card" key={item.id}>
                <div className="list-card-head">
                  <Badge tone={item.kind === "quiz" ? "accent" : "neutral"}>{item.kind}</Badge>
                  <Badge tone={item.ai_generated ? "warning" : "success"}>
                    {item.ai_generated ? "AI-generated" : "manual"}
                  </Badge>
                  <Badge
                    tone={
                      item.status === "mastered"
                        ? "success"
                        : item.status === "review"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {item.status}
                  </Badge>
                  <span className="muted small">{item.reviews} reviews</span>
                </div>
                <h3 className="study-question">{item.question}</h3>
                {revealed[item.id] ? (
                  <div className="study-answer">
                    <p>{item.answer}</p>
                    {item.explanation ? <p className="muted small">{item.explanation}</p> : null}
                  </div>
                ) : (
                  <p className="muted small">Answer hidden.</p>
                )}
                <div className="card-actions">
                  <button
                    type="button"
                    className="button ghost small"
                    onClick={() =>
                      setRevealed((current) => ({ ...current, [item.id]: !current[item.id] }))
                    }
                  >
                    {revealed[item.id] ? "Hide answer" : "Show answer"}
                  </button>
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={() => void progress(item, "review")}
                    disabled={busy}
                  >
                    Needs review
                  </button>
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => void progress(item, "mastered")}
                    disabled={busy}
                  >
                    Mastered
                  </button>
                  <button
                    type="button"
                    className="button danger small"
                    onClick={() => void removeItem(item)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add a manual card">
        <form className="form-stack" onSubmit={addItem}>
          <div className="form-grid">
            <label className="field">
              <span>Kind</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as "flashcard" | "quiz")}>
                <option value="flashcard">Flashcard</option>
                <option value="quiz">Quiz</option>
              </select>
            </label>
            <label className="field grow">
              <span>Question</span>
              <input
                type="text"
                value={question}
                maxLength={1000}
                onChange={(event) => setQuestion(event.target.value)}
                required
              />
            </label>
          </div>
          <label className="field">
            <span>Answer</span>
            <textarea
              value={answer}
              rows={3}
              maxLength={2000}
              onChange={(event) => setAnswer(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Explanation (optional)</span>
            <input
              type="text"
              value={explanation}
              maxLength={1000}
              onChange={(event) => setExplanation(event.target.value)}
            />
          </label>
          <button type="submit" className="button secondary" disabled={busy}>
            Add card
          </button>
        </form>
      </Card>
    </div>
  );
}
