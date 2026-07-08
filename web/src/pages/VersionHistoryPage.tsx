/**
 * VersionHistoryPage — the `/document/{id}/history` route. The flagship
 * compliance surface (UX-18) rendered full-width, peer of the editor
 * route. Auth-gated by App.tsx's Router (only renders when authed).
 *
 * Loads the FileDto (seeded from history.state on the hot path, cold-
 * fetched via GET /api/files/{id} on refresh / deep-link) so the header
 * can name the document, then hands off to <VersionHistory>.
 */
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { getFile, type FileDto } from "../api/client.ts";
import { VersionHistory } from "../components/VersionHistory.tsx";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; file: FileDto }
  | { kind: "error"; message: string };

function fileFromHistory(fileId: string): FileDto | null {
  try {
    const st = window.history.state;
    if (st && typeof st === "object" && "file" in st) {
      const f = (st as { file?: FileDto }).file;
      if (f && f.id === fileId) return f;
    }
  } catch {
    /* ignored */
  }
  return null;
}

function goBack() {
  // Prefer real browser-back so the user returns to where they were;
  // fall back to the vault root.
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function VersionHistoryPage({ fileId }: { fileId: string }) {
  const [state, setState] = useState<LoadState>(() => {
    const seeded = fileFromHistory(fileId);
    return seeded ? { kind: "ready", file: seeded } : { kind: "loading" };
  });

  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    void (async () => {
      try {
        const file = await getFile(fileId);
        if (!cancelled) setState({ kind: "ready", file });
      } catch (err) {
        if (!cancelled)
          setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        goBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fileName =
    state.kind === "ready" ? state.file.name : state.kind === "error" ? "Document" : "Loading…";

  return (
    <div
      data-testid="version-history-page"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        // Flat neobrutalist canvas — let the fixed ambient dotted-grid
        // ground show through (not an opaque surface panel).
        background: "transparent",
      }}
    >
      <header
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "12px var(--space-6)",
          borderBottom: "var(--border-w) solid var(--border)",
          background: "var(--bg-surface)",
        }}
      >
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          title="Back (Esc)"
          className="press-sink"
          style={{
            padding: 7,
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            color: "var(--fg-default)",
            cursor: "pointer",
            display: "inline-flex",
          }}
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <div className="caps-label" style={{ color: "var(--fg-default)", fontWeight: "var(--weight-bold)" }}>Version history</div>
      </header>

      <main
        className="cd-history-main"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
          padding: "var(--space-6)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {state.kind === "error" ? (
            <div role="alert" style={{ fontSize: "var(--text-sm)", color: "var(--fg-default)" }}>
              Couldn't open version history — {state.message}
            </div>
          ) : (
            <VersionHistory fileId={fileId} fileName={fileName} variant="full" />
          )}
        </div>
      </main>
    </div>
  );
}
