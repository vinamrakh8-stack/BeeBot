import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, MetaRow } from "../components/ui";
import { formatDateTime } from "../lib/format";
import type { GraphEdge, GraphNode, GraphResponse } from "../types";

const TYPES = ["conversation", "meeting", "learning", "task", "memory", "participant"] as const;
type GraphType = (typeof TYPES)[number];

const COLORS: Record<string, string> = {
  conversation: "#b45309",
  meeting: "#2563eb",
  learning: "#15803d",
  task: "#7c3aed",
  memory: "#db2777",
  participant: "#6b7280",
};

const MAX_NODES = 60;

export default function KnowledgeGraphPage() {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<Set<GraphType>>(new Set(TYPES));
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [relation, setRelation] = useState("related_to");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await api.get<GraphResponse>("/api/knowledge-graph"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };
    const needle = query.trim().toLowerCase();
    const nodes = graph.nodes.filter(
      (node) =>
        types.has(node.type as GraphType) &&
        (!needle ||
          node.label.toLowerCase().includes(needle) ||
          node.id.toLowerCase().includes(needle)),
    );
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
  }, [graph, query, types]);

  const display = useMemo(() => filtered.nodes.slice(0, MAX_NODES), [filtered.nodes]);
  const displayIds = useMemo(() => new Set(display.map((node) => node.id)), [display]);
  const displayEdges = useMemo(
    () => filtered.edges.filter((edge) => displayIds.has(edge.source) && displayIds.has(edge.target)),
    [filtered.edges, displayIds],
  );

  const positions = useMemo(() => {
    const byType = new Map<string, GraphNode[]>();
    for (const node of display) {
      const list = byType.get(node.type) ?? [];
      list.push(node);
      byType.set(node.type, list);
    }
    const usedTypes = TYPES.filter((type) => (byType.get(type)?.length ?? 0) > 0);
    const result = new Map<string, { x: number; y: number }>();
    usedTypes.forEach((type, typeIndex) => {
      const list = byType.get(type) ?? [];
      const x = usedTypes.length === 1 ? 500 : 90 + typeIndex * (820 / Math.max(1, usedTypes.length - 1));
      list.forEach((node, index) => {
        const y =
          list.length === 1 ? 350 : 70 + index * (560 / Math.max(1, list.length - 1));
        result.set(node.id, { x, y });
      });
    });
    return result;
  }, [display]);

  const selectedNode = display.find((node) => node.id === selected) ?? null;

  async function addEdge() {
    if (!selected || !target) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await api.post<GraphEdge>("/api/knowledge-graph/edges", {
        from_ref: selected,
        to_ref: target,
        relation: relation.trim() || "related_to",
      });
      await load();
      setNotice("Relationship saved as an operator-confirmed edge.");
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeEdge(edge: GraphEdge) {
    const raw = edge.id.startsWith("stored:") ? edge.id.slice("stored:".length) : "";
    if (!raw || !/^\d+$/.test(raw)) return;
    if (!window.confirm("Delete this saved relationship? Both records stay intact.")) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.del(`/api/knowledge-graph/edges/${raw}`);
      await load();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function toggleType(type: GraphType, checked: boolean) {
    setTypes((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  if (loading && !graph) return <LoadingBlock label="Building knowledge graph…" />;

  return (
    <div className="page-stack">
      <Card
        title="Knowledge graph"
        subtitle="Derived from records that already exist in the app. No graph database and no invented people or projects."
        actions={
          graph ? <Badge tone="neutral">{formatDateTime(graph.generated_at)}</Badge> : null
        }
      >
        <div className="form-grid">
          <label className="field grow">
            <span>Filter by label or id</span>
            <input
              type="search"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. roadmap, person, conversation:12"
            />
          </label>
          <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="type-filters" role="group" aria-label="Graph node types">
          {TYPES.map((type) => (
            <label key={type} className="checkbox-inline">
              <input
                type="checkbox"
                checked={types.has(type)}
                onChange={(event) => toggleType(type, event.target.checked)}
              />
              {type}
            </label>
          ))}
        </div>
        {graph ? <p className="muted small">{graph.note}</p> : null}
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

      {graph && filtered.nodes.length === 0 ? (
        <EmptyState
          title="No graph nodes match"
          description="Sync Bee, create a memory or task, or relax the filters. The graph only shows stored records and source-supported participant labels."
        />
      ) : null}

      {display.length > 0 ? (
        <Card
          title="Graph"
          subtitle={`Showing ${display.length} of ${filtered.nodes.length} matching nodes. Solid edges are derived from source links; dashed edges were saved by the operator.`}
        >
          <div className="graph-wrap">
            <svg
              className="graph-svg"
              viewBox="0 0 1000 700"
              role="img"
              aria-label="Knowledge graph"
            >
              {displayEdges.map((edge) => {
                const from = positions.get(edge.source);
                const to = positions.get(edge.target);
                if (!from || !to) return null;
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className="graph-edge"
                    strokeDasharray={edge.derived ? undefined : "6 5"}
                  >
                    <title>{`${edge.relation} (${Math.round(edge.confidence * 100)}%)`}</title>
                  </line>
                );
              })}
              {display.map((node) => {
                const position = positions.get(node.id);
                if (!position) return null;
                const active = node.id === selected;
                return (
                  <g
                    key={node.id}
                    className={`graph-node type-${node.type} ${active ? "selected" : ""}`}
                    transform={`translate(${position.x}, ${position.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.type}: ${node.label}`}
                    onClick={() => {
                      setSelected(node.id);
                      setTarget("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(node.id);
                      }
                    }}
                  >
                    <circle r={active ? 12 : 8} fill={COLORS[node.type] ?? "#6b7280"} />
                    <text x={14} y={4} className="graph-label">
                      {node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          {filtered.nodes.length > MAX_NODES ? (
            <p className="muted small">
              {filtered.nodes.length - MAX_NODES} more nodes are hidden. Narrow the filter to see
              them.
            </p>
          ) : null}
        </Card>
      ) : null}

      {display.length > 0 ? (
        <div className="grid-2">
          <Card title="Selected node">
            {selectedNode ? (
              <>
                <MetaRow label="Type">
                  <Badge tone="neutral">{selectedNode.type}</Badge>
                </MetaRow>
                <MetaRow label="Label">{selectedNode.label}</MetaRow>
                <MetaRow label="Source">{selectedNode.source ?? "Derived from stored records"}</MetaRow>
                <MetaRow label="Verified">
                  <Badge tone={selectedNode.verified ? "success" : "warning"}>
                    {selectedNode.verified ? "source-backed" : "unverified label"}
                  </Badge>
                </MetaRow>
                <Link to={selectedNode.route} className="button ghost small">
                  Open record
                </Link>
                <pre className="graph-meta">{JSON.stringify(selectedNode.metadata, null, 2)}</pre>
              </>
            ) : (
              <p className="muted">Click a node to inspect it and link it to another node.</p>
            )}
          </Card>

          <Card title="Add a confirmed relationship" subtitle="Stored edges are explicit operator decisions, separate from derived source links.">
            {selectedNode ? (
              <div className="form-stack">
                <MetaRow label="From">{selectedNode.label}</MetaRow>
                <label className="field">
                  <span>To</span>
                  <select value={target} onChange={(event) => setTarget(event.target.value)}>
                    <option value="">Select another node…</option>
                    {display
                      .filter((node) => node.id !== selectedNode.id)
                      .map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.type}: {node.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>Relationship</span>
                  <input
                    type="text"
                    value={relation}
                    maxLength={64}
                    onChange={(event) => setRelation(event.target.value)}
                    placeholder="related_to"
                  />
                </label>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void addEdge()}
                  disabled={busy || !target}
                >
                  {busy ? "Saving…" : "Save relationship"}
                </button>
              </div>
            ) : (
              <p className="muted">Select a node first.</p>
            )}
          </Card>
        </div>
      ) : null}

      {display.length > 0 ? (
        <Card title="Relationships" subtitle="Derived links are read-only; saved edges can be removed.">
          <ul className="plain-list">
            {displayEdges.slice(0, 80).map((edge) => (
              <li key={edge.id}>
                <span>
                  {edge.source} → {edge.target}{" "}
                  <Badge tone={edge.derived ? "neutral" : "accent"}>
                    {edge.relation}
                  </Badge>
                </span>
                <span className="edge-actions">
                  <span className="muted small">{Math.round(edge.confidence * 100)}%</span>
                  {!edge.derived ? (
                    <button
                      type="button"
                      className="button danger small"
                      onClick={() => void removeEdge(edge)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
