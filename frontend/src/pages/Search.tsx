import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { LocalSearchResponse, SearchResponse } from "../types";

type Mode = "keyword" | "neural";
type Filter = "all" | "conversations" | "daily" | "facts";

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function resultSummary(result: Record<string, unknown>): string {
  return (
    asText(result.short_summary) ??
    asText(result.summary) ??
    asText(result.detailed_summary) ??
    asText(result.text) ??
    asText(result.answer) ??
    "No summary text returned for this result."
  );
}

export default function Search() {
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"bee" | "local">("bee");
  const [mode, setMode] = useState<Mode>("keyword");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"relevance" | "mostRecent">("relevance");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [localData, setLocalData] = useState<LocalSearchResponse | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runSearch() {
    const query = input.trim();
    if (!query) return;

    setLoading(true);
    setError(null);
    setSearched(true);
    setData(null);
    setLocalData(null);

    if (scope === "local") {
      try {
        setLocalData(
          await api.get<LocalSearchResponse>(
            `/api/search/local?${new URLSearchParams({ q: query, limit: "25" }).toString()}`,
          ),
        );
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
      return;
    }

    const params = new URLSearchParams({ q: query, mode, limit: "25" });
    if (mode === "keyword") {
      params.set("filter", filter);
      params.set("sort", sort);
    }

    try {
      setData(await api.get<SearchResponse>(`/api/search?${params.toString()}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  return (
    <div className="page-stack">
      <Card>
        <form onSubmit={onSubmit} className="search-form">
          <label className="field grow">
            <span>Search your Bee context</span>
            <input
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="What did I discuss about the roadmap?"
              required
            />
          </label>

          <div className="search-options">
            <div className="segmented" role="group" aria-label="Search scope">
              <button
                type="button"
                className={`segment ${scope === "bee" ? "active" : ""}`}
                aria-pressed={scope === "bee"}
                onClick={() => setScope("bee")}
              >
                Bee index
              </button>
              <button
                type="button"
                className={`segment ${scope === "local" ? "active" : ""}`}
                aria-pressed={scope === "local"}
                onClick={() => setScope("local")}
              >
                Local records
              </button>
            </div>

            {scope === "bee" ? (
              <div className="segmented" role="group" aria-label="Search mode">
                <button
                  type="button"
                  className={`segment ${mode === "keyword" ? "active" : ""}`}
                  aria-pressed={mode === "keyword"}
                  onClick={() => setMode("keyword")}
                >
                  Keyword
                </button>
                <button
                  type="button"
                  className={`segment ${mode === "neural" ? "active" : ""}`}
                  aria-pressed={mode === "neural"}
                  onClick={() => setMode("neural")}
                >
                  Semantic
                </button>
              </div>
            ) : null}

            {scope === "bee" && mode === "keyword" ? (
              <>
                <label className="field inline">
                  <span>Scope</span>
                  <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as Filter)}
                  >
                    <option value="all">Conversations, summaries, memories</option>
                    <option value="conversations">Conversations</option>
                    <option value="daily">Daily summaries</option>
                    <option value="facts">Memories</option>
                  </select>
                </label>

                <label className="field inline">
                  <span>Sort</span>
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as "relevance" | "mostRecent")
                    }
                  >
                    <option value="relevance">Relevance</option>
                    <option value="mostRecent">Most recent</option>
                  </select>
                </label>
              </>
            ) : scope === "bee" ? (
              <p className="muted small">
                Semantic search covers conversations only — a Bee API constraint.
              </p>
            ) : (
              <p className="muted small">
                Searches stored summaries, memories, tasks, meetings, and learning notes without
                calling Bee or using embeddings.
              </p>
            )}

            <button type="submit" className="button primary" disabled={loading || !input.trim()}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void runSearch()} /> : null}
      {loading ? (
        <LoadingBlock label={scope === "local" ? "Searching stored records…" : "Searching Bee…"} />
      ) : null}

      {!loading && searched && !error && scope === "local" && localData && localData.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No local results"
            description="No stored summary, memory, task, meeting, or learning note matched that phrase. Try a broader keyword or sync more records."
          />
        </Card>
      ) : null}

      {scope === "local" && localData && localData.items.length > 0 ? (
        <div className="list-stack">
          <p className="muted small">
            {localData.items.length} local results · {localData.note}
          </p>
          {localData.items.map((item) => (
            <article className="list-card" key={item.ref}>
              <div className="list-card-head">
                <Badge tone="neutral">{item.kind}</Badge>
                <Badge tone={item.verified ? "success" : "warning"}>
                  {item.verified ? "source-backed" : "generated / unverified"}
                </Badge>
                <span className="muted small">{formatDateTime(item.occurred_at)}</span>
              </div>
              <Link to={item.route} className="list-card-title">
                {item.title}
              </Link>
              <p className="muted small">{item.snippet}</p>
              <div className="list-card-foot">
                <span className="muted small">{item.ref}</span>
                <Link to={item.route} className="button ghost small">
                  Open
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && searched && !error && scope === "bee" && data && data.results.length === 0 ? (
        <Card>
          <EmptyState
            title="No results"
            description="Bee searches its own index. Try a broader phrase, or switch between keyword and semantic modes."
          />
        </Card>
      ) : null}

      {data && data.results.length > 0 ? (
        <div className="list-stack">
          <p className="muted small">
            {data.results.length}
            {data.total != null ? ` of ${data.total}` : ""} results · {data.mode} · {data.filter}
          </p>

          {data.results.map((result, index) => {
            const id = asNumber(result.id);
            const start = asNumber(result.start_time);
            const occurred = start ? new Date(start).toISOString() : null;
            const state = asText(result.state);

            return (
              <article className="list-card" key={id ?? index}>
                <div className="list-card-head">
                  <span className="muted small">{formatDateTime(occurred)}</span>
                  {state ? <Badge tone="neutral">{state}</Badge> : null}
                </div>

                {id != null ? (
                  <Link to={`/conversations/${id}`} className="list-card-title">
                    {resultSummary(result)}
                  </Link>
                ) : (
                  <p className="list-card-title">{resultSummary(result)}</p>
                )}

                {id != null ? (
                  <div className="list-card-foot">
                    <span className="muted small">Conversation {id}</span>
                    <Link to={`/conversations/${id}`} className="button ghost small">
                      Open
                    </Link>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
