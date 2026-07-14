// AskPanel — the RAG question-answering surface (Phase 5). When the search
// query reads like a question, this fetches POST /api/search/ask and shows a
// composed answer with clickable source citations. Renders nothing for
// keyword-style queries or when no passage addresses the question, so it never
// clutters ordinary search.

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { askQuestion, type AskCitation } from "../api/client.ts";

/** Heuristic: is this query phrased as a question worth answering? Requires a
 *  few words AND either a trailing "?" or a leading question/aux word — so a
 *  bare keyword search ("budget") doesn't trigger an answer card. */
export function isQuestionLike(query: string): boolean {
  const q = query.trim();
  if (q.split(/\s+/).length < 3) return false;
  if (q.endsWith("?")) return true;
  return /^(how|what|why|when|where|who|which|whose|whom|is|are|was|were|can|could|should|would|will|does|do|did)\b/i.test(
    q,
  );
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answered"; answer: string; citations: AskCitation[] }
  | { kind: "empty" };

export function AskPanel({
  query,
  workspace,
  onOpenFile,
}: {
  query: string;
  workspace: string | null;
  onOpenFile: (fileId: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const q = query.trim();
    if (!isQuestionLike(q)) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const res = await askQuestion(q, { workspace, signal: controller.signal });
        if (controller.signal.aborted) return;
        setState(
          res.answer.trim()
            ? { kind: "answered", answer: res.answer, citations: res.citations }
            : { kind: "empty" },
        );
      } catch {
        if (!controller.signal.aborted) setState({ kind: "idle" });
      }
    }, 350);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, workspace]);

  if (state.kind === "idle" || state.kind === "empty") return null;

  return (
    <section
      aria-label="Answer"
      data-testid="ask-panel"
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontSize: "var(--text-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: "var(--violet-500)",
        }}
      >
        <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
        Answer
      </div>

      {state.kind === "loading" ? (
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--muted)",
          }}
        >
          Reading your documents…
        </p>
      ) : (
        <>
          <p
            data-testid="ask-answer"
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
        </>
      )}
    </section>
  );
}
