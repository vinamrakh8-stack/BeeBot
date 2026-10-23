import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import type { ActivityItem } from "../types";
import { Badge } from "./ui";

const KIND_TONE: Record<string, "accent" | "success" | "warning" | "neutral"> = {
  conversation: "accent",
  daily: "success",
  fact: "neutral",
  todo: "warning",
};

function linkFor(item: ActivityItem): string | null {
  if (item.kind === "conversation") return `/conversations/${item.bee_id}`;
  if (item.kind === "daily") return "/daily";
  if (item.kind === "fact") return "/memory";
  if (item.kind === "todo") return "/tasks";
  return null;
}

export default function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="muted">No activity yet. Run a sync to pull data from Bee.</p>;
  }

  return (
    <ol className="timeline">
      {items.map((item) => {
        const href = linkFor(item);
        return (
          <li key={`${item.kind}-${item.bee_id}`} className="timeline-item">
            <span className={`timeline-dot ${KIND_TONE[item.kind] ?? "neutral"}`} aria-hidden="true" />
            <div className="timeline-body">
              <div className="timeline-head">
                <Badge tone={KIND_TONE[item.kind] ?? "neutral"}>{item.kind}</Badge>
                <time className="muted" dateTime={item.occurred_at ?? undefined}>
                  {formatDateTime(item.occurred_at)}
                </time>
              </div>
              {href ? (
                <Link to={href} className="timeline-title">
                  {item.title}
                </Link>
              ) : (
                <span className="timeline-title">{item.title}</span>
              )}
              {item.subtitle ? <p className="muted small">{item.subtitle}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
