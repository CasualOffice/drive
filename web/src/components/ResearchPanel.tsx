// ResearchPanel — the agentic research surface. Where AskPanel auto-answers a
// question with a single extractive pass, this escalates to the agent loop
// (POST /api/agent/ask): the configured LLM runs its own multi-step searches
// and answers with citations. Because that loop is deliberate, multi-round, and
// needs a configured AI provider, it is triggered by an explicit action rather
// than on every keystroke. The agent's search trace is surfaced so its
// reasoning is transparent. When no provider is configured the backend reports
// `available:false` and this shows a quiet hint, never an error.

import { useEffect, useState } from "react";
import { Telescope, Search } from "lucide-react";
import { researchQuestion, type AgentCitation } from "../api/client.ts";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done";
      answer: string;
      citations: AgentCitation[];
      searches: string[];
    }
  | { kind: "unavailable" }
  | { kind: "error" };

const LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "var(--text-xs)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "var(--violet-500)",
};

export function ResearchPanel({
  query,
  onOpenFile,
}: {
  query: string;
  onOpenFile: (fileId: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  // A new query invalidates any prior result — reset to the trigger.
  useEffect(() => {
    setState({ kind: "idle" });
  }, [query]);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setState({ kind: "loading" });
    try {
      const res = await researchQuestion(q);
      if (!res.available) {
        setState({ kind: "unavailable" });
        return;
      }
      setState({
        kind: "done",
        answer: res.answer,
        citations: res.citations,
        searches: res.searches,
      });
    } catch {
      setState({ kind: "error" });
    }
  };

  return (
    <section
      aria-label="Research"
      data-testid="research-panel"
      style={{
        marginTop: 8,
        marginBottom: 18,
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-surface)",
        boxShadow: "var(--shadow-sm)",
        padding: "14px 16px",
      }}
    >
      <div style={{ ...LABEL_STYLE, marginBottom: 10 }}>
        <Telescope size={14} strokeWidth={2} aria-hidden="true" />
        Research
      </div>

      {state.kind === "idle" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-sm)",
              color: "var(--muted)",
              maxWidth: 460,
            }}
          >
            Let the assistant search across your documents step by step and
            compose a cited answer.
          </p>
          <button
            type="button"
            className="press-sink"
            data-testid="research-run"
            onClick={run}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--violet-500)",
              color: "#fff",
              padding: "7px 12px",
              fontSize: "var(--text-sm)",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            <Telescope size={14} strokeWidth={2.4} aria-hidden="true" />
            Research this
          </button>
        </div>
      )}

      {state.kind === "loading" && (
        <p
          data-testid="research-loading"
          style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)" }}
        >
          Researching — searching your documents and reading the results…
        </p>
      )}

      {state.kind === "unavailable" && (
        <p
          data-testid="research-unavailable"
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          Agentic research needs a configured AI provider. Set{" "}
          <code style={{ fontFamily: "var(--font-mono, monospace)" }}>
            DOCHUB_AI_PROVIDER
          </code>{" "}
          (local, OpenAI, or Claude) to enable it. The instant answer above works
          without one.
        </p>
      )}

      {state.kind === "error" && (
        <p
          data-testid="research-error"
          style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)" }}
        >
          Research could not be completed. Try again in a moment.
        </p>
      )}

      {state.kind === "done" && (
        <>
          {state.answer.trim() ? (
            <p
              data-testid="research-answer"
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                lineHeight: 1.55,
                color: "var(--fg-default)",
                whiteSpace: "pre-wrap",
              }}
            >
              {state.answer}
            </p>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                color: "var(--muted)",
              }}
            >
              The assistant could not find an answer in your documents.
            </p>
          )}

          {state.citations.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Sources
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                {state.citations.map((c) => (
                  <li key={`${c.file_id}-${c.snippet.slice(0, 16)}`}>
                    <button
                      type="button"
                      className="press-sink"
                      onClick={() => onOpenFile(c.file_id)}
                      title={c.snippet}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        maxWidth: 260,
                        cursor: "pointer",
                        border: "var(--border-w) solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--violet-100)",
                        color: "var(--fg-default)",
                        padding: "4px 8px",
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.searches.length > 0 && (
            <div style={{ marginTop: 12 }} data-testid="research-trace">
              <div
                style={{
                  fontSize: "var(--text-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                Searches run
              </div>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {state.searches.map((s, i) => (
                  <li
                    key={`${i}-${s}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "var(--text-xs)",
                      color: "var(--muted)",
                    }}
                  >
                    <Search size={12} strokeWidth={2} aria-hidden="true" />
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
