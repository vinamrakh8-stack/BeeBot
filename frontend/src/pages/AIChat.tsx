import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../api";
import { EmptyState, ErrorBanner, LoadingBlock, Spinner } from "../components/States";
import SourceList from "../components/Sources";
import { Badge, Card } from "../components/ui";
import type { AssistantStatus, ChatResponse, ContextSource } from "../types";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources?: ContextSource[];
  clarification?: boolean;
  model?: string | null;
}

const SUGGESTIONS = [
  "What did I discuss in my most recent conversation?",
  "What open tasks do I have and when are they due?",
  "Summarize what I decided about the roadmap.",
];

export default function AIChat() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AssistantStatus>("/api/assistant/status")
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch((caught) => {
        if (!cancelled) setStatusError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, sending]);

  async function send(text: string, options: { appendUser?: boolean } = {}) {
    const clean = text.trim();
    if (!clean || sending) return;
    setError(null);
    setFailedText(null);
    setSending(true);
    // A retry reuses the question already shown in the log instead of adding a
    // duplicate bubble and instead of sending the (now cleared) input box.
    if (options.appendUser !== false) {
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: "user", text: clean },
      ]);
    }
    setInput("");

    try {
      const response = await api.post<ChatResponse>("/api/assistant/chat", {
        message: clean,
      });
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          role: "assistant",
          text: response.answer,
          sources: response.sources,
          clarification: response.clarification_needed,
          model: response.model,
        },
      ]);
    } catch (caught) {
      setError(errorMessage(caught));
      setFailedText(clean);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  if (statusError && !status) {
    return <ErrorBanner message={statusError} />;
  }

  return (
    <div className="page-stack">
      <Card
        title="AI chat with your context"
        subtitle="Answers are grounded in stored records. The app never invents personal history or citations."
        actions={
          status ? (
            <Badge tone={status.configured ? "success" : "warning"}>
              {status.configured ? `model: ${status.model}` : "AI provider not configured"}
            </Badge>
          ) : null
        }
      >
        {status && !status.configured ? (
          <div className="inline-alert warning" role="status">
            <div>
              <strong>AI provider not configured</strong>
              <p className="small">
                Context retrieval and deterministic pages still work. To generate answers,
                set <code>AI_API_KEY</code> (and optionally <code>AI_BASE_URL</code> /{" "}
                <code>AI_MODEL</code>) on the server, then restart it. Your key is never sent
                to the browser.
              </p>
              <Link to="/settings" className="button ghost small">
                Open settings
              </Link>
            </div>
          </div>
        ) : null}

        <div className="chat-log" aria-live="polite">
          {messages.length === 0 ? (
            <EmptyState
              title="Ask about your own records"
              description="Questions are matched against conversations, summaries, memories, tasks, meetings, and learning notes already stored for this account. If the evidence is missing, the assistant asks for clarification instead of guessing."
            />
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-bubble">
                  {message.role === "assistant" && message.model ? (
                    <span className="muted small chat-meta">
                      {message.clarification ? "No matching evidence" : `AI-generated · ${message.model}`}
                    </span>
                  ) : null}
                  <p className="chat-text">{message.text}</p>
                  {message.sources && message.sources.length > 0 ? (
                    <SourceList sources={message.sources} />
                  ) : null}
                </div>
              </article>
            ))
          )}
          {sending ? (
            <div className="chat-message assistant">
              <div className="chat-bubble">
                <Spinner label="Thinking" /> <span className="muted small">Retrieving context and asking the model…</span>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        {error ? (
          <ErrorBanner
            message={error}
            onRetry={
              failedText
                ? () => void send(failedText, { appendUser: false })
                : undefined
            }
          />
        ) : null}

        <form className="chat-form" onSubmit={onSubmit}>
          <label className="field grow">
            <span className="sr-only">Ask a question about your records</span>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a person, project, decision, deadline, or conversation…"
              rows={3}
              maxLength={2000}
            />
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={sending || !input.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>

        {messages.length === 0 ? (
          <div className="suggestion-row" aria-label="Suggested questions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="button ghost small"
                onClick={() => void send(suggestion)}
                disabled={sending}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      {status ? (
        <Card title="How grounding works">
          <ul className="plain-list">
            <li>
              <span>Retrieval mode</span>
              <Badge tone="neutral">{status.retrieval.mode}</Badge>
            </li>
            <li>
              <span>Semantic embeddings</span>
              <Badge tone={status.retrieval.embeddings ? "success" : "warning"}>
                {status.retrieval.embeddings ? "enabled" : "not configured"}
              </Badge>
            </li>
            <li>
              <span>Sources per answer</span>
              <span className="muted small">up to {status.max_context_sources}</span>
            </li>
          </ul>
          <p className="muted small">{status.retrieval.note}</p>
        </Card>
      ) : null}

      {!status && !statusError ? <LoadingBlock label="Checking AI configuration…" /> : null}
    </div>
  );
}
