import { useCallback, useState } from "react";
import { api, errorMessage } from "../api";
import ActivityFeed from "../components/ActivityFeed";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Card } from "../components/ui";
import { useReloadEffect } from "../store";
import type { ActivityItem } from "../types";

export default function Activity() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [limit, setLimit] = useState(40);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.get<ActivityItem[]>(`/api/activity?limit=${limit}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page-stack">
      <Card
        title="Timeline"
        subtitle="Merged from synced conversations, daily summaries, memories and tasks."
        actions={
          <label className="field inline">
            <span>Show</span>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              <option value={20}>20 items</option>
              <option value={40}>40 items</option>
              <option value={80}>80 items</option>
            </select>
          </label>
        }
      >
        {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
        {loading && !items ? <LoadingBlock label="Building timeline…" /> : null}

        {items && items.length === 0 ? (
          <EmptyState
            title="Nothing on the timeline"
            description="Activity appears here once Bee data has been synced."
          />
        ) : null}

        {items && items.length > 0 ? <ActivityFeed items={items} /> : null}
      </Card>
    </div>
  );
}
