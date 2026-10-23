import { useCallback, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import Pagination from "../components/Pagination";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateTime, truncate } from "../lib/format";
import { useReloadEffect } from "../store";
import type { Conversation, Page } from "../types";

const LIMIT = 20;

export default function Conversations() {
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Page<Conversation> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (query) params.set("q", query);
      setData(await api.get<Page<Conversation>>(`/api/conversations?${params.toString()}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [offset, query]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setQuery(searchInput.trim());
  }

  return (
    <div className="page-stack">
      <Card>
        <form onSubmit={onSearch} className="toolbar" role="search">
          <label className="field inline">
            <span className="sr-only">Filter conversations</span>
            <input
              type="search"
              placeholder="Filter by summary text…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <button type="submit" className="button secondary">
            Filter
          </button>
          {query ? (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                setSearchInput("");
                setQuery("");
                setOffset(0);
              }}
            >
              Clear
            </button>
          ) : null}
          <span className="muted small">
            This filters synced text. Full-text search over Bee lives in{" "}
            <Link to="/search">Search</Link>.
          </span>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading && !data ? <LoadingBlock label="Loading conversations…" /> : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={query ? "No matching conversations" : "No conversations yet"}
            description={
              query
                ? "Try a different phrase, or use server-side search for semantic results."
                : "Sync to import conversations from your Bee account."
            }
          />
        </Card>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="list-stack">
          {data.items.map((conversation) => (
            <article className="list-card" key={conversation.bee_id}>
              <div className="list-card-head">
                <time className="muted small" dateTime={conversation.start_time ?? undefined}>
                  {formatDateTime(conversation.start_time)}
                </time>
                <Badge tone={conversation.state === "processed" ? "success" : "warning"}>
                  {conversation.state}
                </Badge>
              </div>
              <Link to={`/conversations/${conversation.bee_id}`} className="list-card-title">
                {conversation.short_summary ??
                  conversation.summary ??
                  `Conversation ${conversation.bee_id}`}
              </Link>
              {conversation.summary && conversation.short_summary ? (
                <p className="muted">{truncate(conversation.summary, 220)}</p>
              ) : null}
              <div className="list-card-foot">
                <span className="muted small">
                  {conversation.device_type ? `${conversation.device_type} · ` : ""}
                  Bee id {conversation.bee_id}
                </span>
                <Link to={`/conversations/${conversation.bee_id}`} className="button ghost small">
                  Open transcript
                </Link>
              </div>
            </article>
          ))}

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
