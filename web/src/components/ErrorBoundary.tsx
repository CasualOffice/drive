/**
 * ErrorBoundary — stops one crashing surface from white-screening the whole
 * SPA. React unmounts the entire tree when a render throws and nothing
 * catches it; without a boundary a single bad component (or a stale
 * lazy-chunk 404 after a redeploy) leaves the user staring at a blank page
 * with no way out. This catches, logs, and renders a recoverable fallback.
 *
 * Two recovery paths:
 *  - **New version available** (a dynamic-import/chunk-load failure — the
 *    common benign cause after a deploy invalidates the old chunk hashes):
 *    the only fix is a full reload to fetch the new manifest.
 *  - **Unexpected error:** offer a soft retry (re-render the subtree) plus a
 *    reload. Pass `resetKey` (e.g. the active nav tab) so navigating away
 *    also clears the error and gives the next surface a clean mount.
 *
 * The fallback is deliberately self-contained — inline styles, no imported
 * presentational components — so the error screen can't itself depend on
 * something that just crashed.
 */
import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

/** Browser phrasings for a failed dynamic import, across engines:
 * Chrome "Failed to fetch dynamically imported module",
 * Firefox "error loading dynamically imported module",
 * Safari "Importing a module script failed". */
const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return CHUNK_ERROR.test(msg) || (err instanceof Error && err.name === "ChunkLoadError");
}

interface Props {
  children: ReactNode;
  /** When this changes, a caught error is cleared and the subtree re-renders.
   * Pass the active route/tab so navigating away recovers automatically. */
  resetKey?: unknown;
  /** Names the surface in the console log — eases triage. */
  surface?: string;
}

interface State {
  error: Error | null;
  /** Mirrors `resetKey` so `getDerivedStateFromProps` can detect a change. */
  resetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
    this.retry = this.retry.bind(this);
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A resetKey change (e.g. the user switched tabs) clears a prior crash so
    // the new surface mounts fresh instead of inheriting the error screen.
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Component stack only — no user data. Gives an operator something to
    // correlate with the access log when a user reports a blank surface.
    const tag = this.props.surface ? `ErrorBoundary:${this.props.surface}` : "ErrorBoundary";
    console.error(`[${tag}]`, error, info.componentStack);
  }

  retry() {
    this.setState({ error: null });
  }

  reload() {
    window.location.reload();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunk = isChunkError(error);
    const title = chunk ? "A new version is available" : "Something went wrong";
    const body = chunk
      ? "This page was updated while you had it open. Reload to get the latest version."
      : "An unexpected error interrupted this view. You can try again, or reload the page.";

    return (
      <div role="alert" style={wrapStyle}>
        <div style={cardStyle}>
          <h2 style={titleStyle}>{title}</h2>
          <p style={bodyStyle}>{body}</p>
          <div style={actionsStyle}>
            {!chunk && (
              <button type="button" onClick={this.retry} style={secondaryBtn}>
                Try again
              </button>
            )}
            <button type="button" onClick={this.reload} style={primaryBtn}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ── styles (neobrutalist: ink borders, hard offset shadow) ───────────────

const wrapStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "var(--space-6, 32px)",
};

const cardStyle: CSSProperties = {
  maxWidth: 420,
  width: "100%",
  background: "var(--card, #fff)",
  border: "var(--border-w, 2px) solid var(--border, #111)",
  borderRadius: "var(--radius, 12px)",
  boxShadow: "var(--shadow, 4px 4px 0 var(--border, #111))",
  padding: "24px",
  textAlign: "center",
};

const titleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-lg, 18px)",
  fontWeight: 700,
  color: "var(--ink, #111)",
};

const bodyStyle: CSSProperties = {
  margin: "0 0 20px",
  fontSize: "var(--text-sm, 14px)",
  lineHeight: 1.5,
  color: "var(--muted, #555)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "center",
};

const baseBtn: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-sm, 14px)",
  fontWeight: 600,
  padding: "8px 16px",
  borderRadius: "var(--radius-sm, 8px)",
  border: "var(--border-w, 2px) solid var(--border, #111)",
  cursor: "pointer",
};

const primaryBtn: CSSProperties = {
  ...baseBtn,
  background: "var(--accent, #8B5CF6)",
  color: "var(--on-violet, #fff)",
};

const secondaryBtn: CSSProperties = {
  ...baseBtn,
  background: "var(--bg-surface, #fff)",
  color: "var(--ink, #111)",
};
