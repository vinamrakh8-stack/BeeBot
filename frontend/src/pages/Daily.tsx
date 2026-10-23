import { useCallback, useState } from "react";
import { api, errorMessage } from "../api";
import Pagination from "../components/Pagination";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card } from "../components/ui";
import { formatDateOnly, formatDateTime } from "../lib/format";
import { useReloadEffect } from "../store";
import type { DailySummary, Page } from "../types";

const LIMIT = 10;

export default function Daily() {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [data, setData] = useState<Page<DailySummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Page<DailySummary>>(`/api/summaries?limit=${LIMIT}&offset=${offset}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  function toggle(beeId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(beeId)) next.delete(beeId);
      else next.add(beeId);
      return next;
    });
  }

  if (loading && !data) return <LoadingBlock label="Loading daily summaries…" />;

  return (
    <div className="page-stack">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {data && data.items.length === 0 ? (
        <Card>
          <EmptyState
            title="No daily summaries yet"
            description="Bee generates a recap for each day it captures activity. Run a sync to import them."
          />
        </Card>
      ) : null}

      {data?.items.map((summary) => {
        const isOpen = expanded.has(summary.bee_id);
        return (
          <Card key={summary.bee_id} className="daily-card">
            <header className="daily-head">
              <div>
                <h2>{summary.day ? formatDateOnly(summary.day) : `Summary ${summary.bee_id}`}</h2>
                <p className="muted small">
                  {summary.conversations_count != null
                    ? `${summary.conversations_count} conversations`
                    : "Conversation count unavailable"}
                  {summary.day_time ? ` · ${formatDateTime(summary.day_time)}` : ""}
                </p>
              </div>
              <div className="card-actions">
                <Badge tone="accent">recap</Badge>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => toggle(summary.bee_id)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? "Collapse" : "Read more"}
                </button>
              </div>
            </header>

            <div className="prose">
              <p>{summary.short_summary ?? "No short summary provided."}</p>
            </div>

            {isOpen ? (
              <div className="daily-detail">
                {summary.summary ? (
                  <section>
                    <h3>Full summary</h3>
                    {summary.summary.split(/\r?\n/).map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </section>
                ) : null}

                {summary.email_summary ? (
                  <section>
                    <h3>Email</h3>
                    {summary.email_summary.split(/\r?\n/).map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </section>
                ) : null}

                {summary.calendar_summary ? (
                  <section>
                    <h3>Calendar</h3>
                    {summary.calendar_summary.split(/\r?\n/).map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </section>
                ) : null}

                {summary.locations && summary.locations.length > 0 ? (
                  <section>
                    <h3>Locations</h3>
                    <ul className="plain-list">
                      {summary.locations.map((location, index) => (
                        <li key={index}>
                          <span>{location.address ?? "Unknown place"}</span>
                          {typeof location.latitude === "number" &&
                          typeof location.longitude === "number" ? (
                            <span className="muted small">
                              {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}

      {data ? (
        <Pagination
          total={data.total}
          limit={data.limit}
          offset={data.offset}
          onChange={setOffset}
        />
      ) : null}
    </div>
  );
}
