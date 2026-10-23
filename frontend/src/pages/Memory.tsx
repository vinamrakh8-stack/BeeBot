import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import Pagination from "../components/Pagination";
import { EmptyState, ErrorBanner, LoadingBlock, Spinner } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useReloadEffect } from "../store";
import type { ExtractCandidate, Fact, Page } from "../types";

const LIMIT = 25;

function originTone(origin?: string) {
  if (origin === "bee") return "success" as const;
  if (origin === "ai") return "warning" as const;
  return "neutral" as const;
}

export default function Memory() {
  const [offset, setOffset] = useState(0);
  const [confirmed, setConfirmed] = useState<"all" | "true" | "false">("all");
  const [origin, setOrigin] = useState<"all" | "bee" | "user" | "ai">("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Page<Fact> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newTags, setNewTags] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editConfirmed, setEditConfirmed] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [extractConversation, setExtractConversation] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [candidates, setCandidates] = useState<ExtractCandidate[]>([]);
  const [candidateSource, setCandidateSource] = useState<number | null>(null);

  useEffect(() => {
    setOffset(0);
  }, [confirmed, origin, query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
        confirmed,
      });
      if (origin !== "all") params.set("origin", origin);
      if (query) params.set("q", query);
      setData(await api.get<Page<Fact>>(`/api/memories?${params.toString()}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [offset, confirmed, origin, query]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(searchInput.trim());
  }

  async function createMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newText.trim()) return;
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      await api.post<Fact>("/api/memories", {
        text: newText.trim(),
        tags: newTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setNewText("");
      setNewTags("");
      setNotice("Memory saved locally. It is not sent to Bee.");
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(fact: Fact) {
    setEditingId(fact.bee_id);
    setEditText(fact.text);
    setEditConfirmed(fact.confirmed);
    setActionError(null);
  }

  async function saveEdit(fact: Fact) {
    setBusyId(fact.bee_id);
    setActionError(null);
    setNotice(null);
    try {
      await api.patch<Fact>(`/api/memories/${fact.bee_id}`, {
        text: editText.trim(),
        confirmed: editConfirmed,
      });
      setEditingId(null);
      setNotice(
        fact.bee_id > 0
          ? "Memory edited. A tombstone prevents the next sync from overwriting it."
          : "Memory updated.",
      );
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function removeMemory(fact: Fact) {
    if (
      !window.confirm(
        "Delete this memory? If it came from Bee, a tombstone will stop sync from recreating it.",
      )
    ) {
      return;
    }
    setBusyId(fact.bee_id);
    setActionError(null);
    try {
      await api.del(`/api/memories/${fact.bee_id}`);
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusyId(null);
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
      }>("/api/memories/extract", { bee_id: Number(value) });
      setCandidates(response.candidates);
      setCandidateSource(response.source.conversation_id);
      if (response.candidates.length === 0) {
        setNotice("The model found no memory candidates supported by that conversation.");
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
      await api.post<Fact>("/api/memories", {
        text: candidate.text,
        tags: candidate.tags ?? [],
        source_bee_id: candidate.conversation_bee_id ?? undefined,
        source_conversation_id:
          candidate.conversation_bee_id == null
            ? candidate.source_conversation_id ?? candidateSource ?? undefined
            : undefined,
        source_excerpt: candidate.excerpt ?? undefined,
        confirmed: false,
        origin: "ai",
      });
      setCandidates((current) => current.filter((item) => item.text !== candidate.text));
      setNotice("Candidate saved as an unconfirmed memory. Nothing is sent to Bee.");
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  return (
    <div className="page-stack">
      <Card title="Add a memory" subtitle="Saved only in this app's database. Bee is not modified.">
        <form className="form-grid" onSubmit={createMemory}>
          <label className="field grow">
            <span>Memory text</span>
            <input
              type="text"
              value={newText}
              maxLength={1000}
              onChange={(event) => setNewText(event.target.value)}
              placeholder="A preference, decision, or fact you want to remember"
              required
            />
          </label>
          <label className="field">
            <span>Tags (comma separated)</span>
            <input
              type="text"
              value={newTags}
              onChange={(event) => setNewTags(event.target.value)}
              placeholder="project, preference"
            />
          </label>
          <button type="submit" className="button primary" disabled={creating || !newText.trim()}>
            {creating ? "Saving…" : "Add memory"}
          </button>
        </form>
      </Card>

      <Card
        title="Extract memories from a conversation"
        subtitle="The AI proposes candidates. Nothing is persisted until you approve each one."
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
          The conversation must already be stored. Extraction requires an AI provider; without
          one, the request fails visibly and no candidates are invented.
        </p>
        {candidates.length > 0 ? (
          <div className="list-stack">
            {candidates.map((candidate, index) => (
              <article className="list-card" key={`${candidate.text}-${index}`}>
                <div className="list-card-head">
                  <Badge tone="warning">AI candidate</Badge>
                  <Badge tone={candidate.duplicate ? "warning" : "neutral"}>
                    {candidate.duplicate ? "possible duplicate" : `${Math.round(candidate.confidence * 100)}% confidence`}
                  </Badge>
                </div>
                <p>{candidate.text}</p>
                {candidate.excerpt ? (
                  <p className="muted small">Source excerpt: “{candidate.excerpt}”</p>
                ) : null}
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => void saveCandidate(candidate)}
                >
                  Save as unconfirmed memory
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <form onSubmit={onSearch} className="toolbar" role="search">
          <label className="field inline">
            <span>Confirmation</span>
            <select
              value={confirmed}
              onChange={(event) => setConfirmed(event.target.value as "all" | "true" | "false")}
            >
              <option value="all">All memories</option>
              <option value="true">Confirmed</option>
              <option value="false">Pending</option>
            </select>
          </label>
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

          <label className="field inline grow">
            <span className="sr-only">Search memories</span>
            <input
              type="search"
              placeholder="Search what Bee remembers…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <button type="submit" className="button secondary">
            Search
          </button>
          {query ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setSearchInput("");
                setQuery("");
              }}
            >
              Clear
            </button>
          ) : null}
        </form>
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
      {loading && !data ? <LoadingBlock label="Loading memories…" /> : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No memories here"
            description="Bee stores facts it learns during conversations. They appear after a sync. Bee exposes no separate contacts or people API, so none is shown."
          />
        </Card>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="list-stack">
          {data.items.map((fact) => {
            const busy = busyId === fact.bee_id;
            return (
              <article className="memory-card" key={fact.bee_id}>
                <div className="memory-head">
                  <Badge tone={fact.confirmed ? "success" : "warning"}>
                    {fact.confirmed ? "confirmed" : "pending review"}
                  </Badge>
                  <Badge tone={originTone(fact.origin)}>
                    {fact.origin === "bee"
                      ? "from Bee"
                      : fact.origin === "ai"
                        ? "AI-suggested"
                        : "local"}
                  </Badge>
                  {fact.ai_generated ? <Badge tone="warning">generated</Badge> : null}
                  <span className="muted small">
                    {formatDateTime(fact.bee_created_at ?? fact.created_at)}
                  </span>
                </div>

                {editingId === fact.bee_id ? (
                  <div className="form-stack">
                    <label className="field">
                      <span>Memory text</span>
                      <input
                        type="text"
                        value={editText}
                        maxLength={1000}
                        onChange={(event) => setEditText(event.target.value)}
                      />
                    </label>
                    <label className="checkbox-inline">
                      <input
                        type="checkbox"
                        checked={editConfirmed}
                        onChange={(event) => setEditConfirmed(event.target.checked)}
                      />
                      Confirmed
                    </label>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="button primary small"
                        onClick={() => void saveEdit(fact)}
                        disabled={busy || !editText.trim()}
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button type="button" className="button ghost small" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="memory-text">{fact.text}</p>
                    {fact.tags && fact.tags.length > 0 ? (
                      <div className="tag-row">
                        {fact.tags.map((tag) => (
                          <span className="tag" key={`${fact.bee_id}-${tag}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {fact.source_excerpt ? (
                      <p className="muted small">Source excerpt: “{fact.source_excerpt}”</p>
                    ) : null}
                    {fact.source_conversation_bee_id ? (
                      <p className="small">
                        <Link to={`/conversations/${fact.source_conversation_bee_id}`}>
                          Source conversation
                        </Link>
                      </p>
                    ) : null}
                    <div className="card-actions">
                      <button type="button" className="button ghost small" onClick={() => startEdit(fact)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button danger small"
                        onClick={() => void removeMemory(fact)}
                        disabled={busy}
                      >
                        {busy ? <Spinner label="Deleting" /> : "Delete"}
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}

          <Pagination
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={setOffset}
          />
        </div>
      ) : null}
    </div>
  );
}
