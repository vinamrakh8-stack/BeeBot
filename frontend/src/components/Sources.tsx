import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import type { ContextSource } from "../types";
import { Badge } from "./ui";

const LABELS: Record<string, string> = {
  conversation: "Conversation",
  daily_summary: "Daily summary",
  memory: "Memory",
  task: "Task",
  meeting: "Meeting",
  learning: "Learning",
};

export default function SourceList({ sources }: { sources: ContextSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="source-list">
      <h3>Sources used</h3>
      <ul>
        {sources.map((source) => (
          <li key={source.ref}>
            <div className="source-head">
              <Badge tone="neutral">{LABELS[source.kind] ?? source.kind}</Badge>
              {source.verified ? (
                <Badge tone="success">source-backed</Badge>
              ) : (
                <Badge tone="warning">generated / unverified</Badge>
              )}
              <span className="muted small">{formatDateTime(source.occurred_at)}</span>
            </div>
            <Link to={source.route} className="source-title">
              {source.title}
            </Link>
            <p className="muted small">{source.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
