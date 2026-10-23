import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { ErrorBanner, LoadingBlock } from "../components/States";
import { Badge, Card, MetaRow } from "../components/ui";
import { formatDateTime, titleCase } from "../lib/format";
import { useReloadEffect } from "../store";
import type { ConversationDetail as Detail, Transcription, Utterance } from "../types";

function pickTranscription(transcriptions?: Transcription[] | null): Transcription | null {
  if (!transcriptions || transcriptions.length === 0) return null;
  return transcriptions.find((item) => !item.realtime) ?? transcriptions[0] ?? null;
}

function utteranceTime(utterance: Utterance): number {
  return utterance.spoken_at ?? utterance.start ?? 0;
}

export default function ConversationDetail() {
  const { beeId } = useParams<{ beeId: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Detail>(`/api/conversations/${beeId}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [beeId]);

  useReloadEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingBlock label="Loading conversation…" />;
  if (error && !data) {
    return (
      <div className="page-stack">
        <ErrorBanner message={error} onRetry={() => void load()} />
        <Link to="/conversations" className="button secondary">
          Back to conversations
        </Link>
      </div>
    );
  }
  if (!data) return null;

  const transcription = pickTranscription(data.transcriptions);
  const utterances = [...(transcription?.utterances ?? [])].sort(
    (a, b) => utteranceTime(a) - utteranceTime(b),
  );

  return (
    <div className="page-stack">
      <div className="detail-head">
        <Link to="/conversations" className="button ghost small">
          ← Conversations
        </Link>
        <div className="detail-title-row">
          <h2>{data.short_summary ?? `Conversation ${data.bee_id}`}</h2>
          <Badge tone={data.state === "processed" ? "success" : "warning"}>{data.state}</Badge>
        </div>
        <p className="muted small">{formatDateTime(data.start_time)}</p>
      </div>

      {data.stale ? (
        <div className="inline-alert warning" role="status">
          Bee was unreachable, so this is the last synced copy. The transcript may be
          incomplete until the next successful refresh.
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid-2">
        <Card title="Summary">
          {data.summary ? (
            <div className="prose">
              {data.summary.split(/\r?\n/).map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="muted">Bee has not produced a detailed summary yet.</p>
          )}
        </Card>

        <Card title="Details">
          <MetaRow label="Bee id">{data.bee_id}</MetaRow>
          <MetaRow label="Device">{data.device_type ?? "—"}</MetaRow>
          <MetaRow label="Started">{formatDateTime(data.start_time)}</MetaRow>
          <MetaRow label="Ended">{formatDateTime(data.end_time)}</MetaRow>
          <MetaRow label="Synced">{formatDateTime(data.synced_at)}</MetaRow>
          {data.primary_location ? (
            <MetaRow label="Location">
              {data.primary_location.address ?? "Unknown"}
              {typeof data.primary_location.latitude === "number" &&
              typeof data.primary_location.longitude === "number"
                ? ` (${data.primary_location.latitude.toFixed(4)}, ${data.primary_location.longitude.toFixed(4)})`
                : ""}
            </MetaRow>
          ) : null}
        </Card>
      </div>

      {data.suggested_links && data.suggested_links.length > 0 ? (
        <Card title="Suggested links">
          <ul className="plain-list">
            {data.suggested_links.map((link, index) =>
              link.url ? (
                <li key={`${link.url}-${index}`}>
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {link.url}
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </Card>
      ) : null}

      <Card
        title="Transcript"
        subtitle="Bee transcripts are automatic speech recognition output and may contain errors."
      >
        {utterances.length === 0 ? (
          <p className="muted">
            No transcript stored yet. Open the conversation again once Bee has finished
            processing it.
          </p>
        ) : (
          <ol className="transcript">
            {utterances.map((utterance, index) => (
              <li key={utterance.id ?? `${index}-${utteranceTime(utterance)}`}>
                <span className="speaker">{titleCase(utterance.speaker || "unknown")}</span>
                <span className="utterance">{utterance.text ?? "(empty)"}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
