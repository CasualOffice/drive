/**
 * FileFullscreen — the `/file/<id>` route. Drive's in-app editor
 * surface, peer of `/home`, `/notes`, `/activity`. ED1 gap (a) in
 * `PIPELINE.md` — the editor breaks out of the Preview modal's
 * 1000×640 frame into the full viewport.
 *
 * Lifecycle:
 *   1. Mount with `fileId` from the URL.
 *   2. Fetch the FileDto via `GET /api/files/{id}` so we know name +
 *      content_type + version. Bytes are NOT fetched here — the SDK
 *      wrapper's own DriveFileSource handles that.
 *   3. Infer kind via FileThumb's `inferKind`. For `doc` mount
 *      `<CasualDocEditor>`; for `sheet` mount
 *      `<CasualSheetWorkspace mode="editor">`. Anything else falls
 *      through to a "no editor for this format" surface — the user
 *      can still download via the back-to-Drive button.
 *   4. A slim top bar shows the filename + a back arrow. Cmd-K
 *      shortcut is intentionally not bound here — the editor's own
 *      shortcuts own this surface.
 *
 * What this page does NOT do:
 *   - Auth gate — `App.tsx` already wraps Router in `<AuthProvider>`,
 *     so a `/file/<id>` URL on an unauthed visitor bounces them to
 *     `<SignIn />`. The fullscreen route only renders when authed.
 *   - File picker / sidebar — the editor wants the whole viewport.
 *     Use the back arrow (or browser back) to return to `/home`.
 *   - Co-edit toggle — already inherited from `<CasualDocEditor>`
 *     via `VITE_DRIVE_COLLAB_BACKEND_URL`. The wrapper handles it.
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, Share2 } from "lucide-react";
import { toast } from "sonner";

import { downloadUrl, getFile, renameFile, trashFile, type FileDto } from "../api/client.ts";
import { EntryKebab } from "../components/EntryMenu.tsx";
import { inferKind } from "../components/FileThumb.tsx";
import { SaveStatusPill } from "../components/editor/SaveStatusPill.tsx";
import type { SaveStatus } from "../components/editor/save-status.ts";
import { ShareDialog } from "../components/ShareDialog.tsx";
import { useReportViewing } from "../state/PresenceContext.tsx";

// Same lazy-load pattern as PreviewStage — both surfaces share the
// same SDK chunks but tax different routes, so the Suspense
// boundary lives per consumer.
const CasualDocEditor = lazy(() =>
  import("../components/editor/CasualDocEditor.tsx").then((m) => ({
    default: m.CasualDocEditor,
  })),
);
const CasualSheetWorkspace = lazy(() =>
  import("../components/editor/CasualSheetWorkspace.tsx").then((m) => ({
    default: m.CasualSheetWorkspace,
  })),
);
// Every non-editor file type (image / pdf / video / audio / text /
// md / generic) reuses PreviewStage's per-kind renderer at the
// fullscreen route. Double-click on the file list lands here for
// EVERY kind under the 2026-06-16 click model — without this fanout
// non-editor types would hit the "No editor for this format" stub.
const PreviewStage = lazy(() =>
  import("../components/preview/PreviewStage.tsx").then((m) => ({
    default: m.PreviewStage,
  })),
);

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; file: FileDto }
  | { kind: "error"; message: string };

export interface FileFullscreenProps {
  fileId: string;
}

/** Pull a FileDto out of `history.state` when Files navigated us here.
 *  Avoids the cold `GET /api/files/{id}` round trip on the hot path
 *  (open-from-file-list); we still fetch when state is empty. */
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

export function FileFullscreen({ fileId }: FileFullscreenProps) {
  const [state, setState] = useState<LoadState>(() => {
    const seeded = fileFromHistory(fileId);
    if (seeded) return { kind: "ready", file: seeded };
    return { kind: "loading" };
  });

  // Cold-load path. When the user lands here via refresh / shared
  // URL / bookmark, history.state is empty; resolve via the new
  // `GET /api/files/{id}` endpoint. Hot loads (open-from-Files
  // through PreviewModal) skip this entirely because the seeded
  // state above already produced `ready`.
  useEffect(() => {
    if (state.kind !== "loading") return;
    let cancelled = false;
    (async () => {
      try {
        const file = await getFile(fileId);
        if (cancelled) return;
        setState({ kind: "ready", file });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Track the live filename for the tab title so refresh / share
  // shows the editor target. Cleared on unmount so other pages can
  // own the title.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const prev = document.title;
    document.title = `${state.file.name} — Casual Drive`;
    return () => {
      document.title = prev;
    };
  }, [state]);

  // RT3 — tell the presence hub which file we're viewing so peers'
  // file rows light up with the viewing dot. Clear on unmount so the
  // dot goes away when we navigate back to /home.
  const reportViewing = useReportViewing();
  useEffect(() => {
    reportViewing(fileId);
    return () => reportViewing(null);
  }, [fileId, reportViewing]);

  const goBack = () => {
    window.history.pushState({}, "", "/");
    // App.tsx's Router only re-reads on pathname-changing nav. Use
    // popstate to nudge it; React-managed state in Shell follows.
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  // Esc → back to /. The iframe owns its own keyboard inside the
  // viewport; this listener fires only when the host page keeps focus
  // (back-button focused, kebab open, no editor frame focused).
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

  const onRename = (next: string) => {
    if (state.kind !== "ready") return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === state.file.name) return;
    const prev = state.file;
    // Optimistic — flip the local state immediately so the title bar
    // doesn't pop back to the old name during the request.
    setState({ kind: "ready", file: { ...prev, name: trimmed } });
    void (async () => {
      try {
        const updated = await renameFile(prev.id, trimmed);
        setState({ kind: "ready", file: updated });
      } catch (err) {
        setState({ kind: "ready", file: prev });
        toast.error(err instanceof Error ? err.message : "Rename failed");
      }
    })();
  };

  // Live save state piped up from the editor wrappers — flips to
  // saving / saved / failed as the SDK's autosave (or a host Ctrl+S)
  // round-trips. The pill collapses to nothing in the idle state.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  return (
    <div
      data-testid="file-fullscreen"
      data-file-id={fileId}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FullscreenHeader
        state={state}
        saveStatus={saveStatus}
        onBack={goBack}
        onRename={onRename}
        onTrash={() => {
          if (state.kind !== "ready") return;
          void (async () => {
            try {
              await trashFile(state.file.id);
              toast.success("Moved to trash");
              goBack();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Couldn't trash file");
            }
          })();
        }}
        onDownload={() => {
          if (state.kind !== "ready") return;
          window.open(downloadUrl(state.file.id), "_blank", "noopener,noreferrer");
        }}
      />
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <FullscreenBody state={state} onSaveStatus={setSaveStatus} />
      </main>
    </div>
  );
}

function FullscreenHeader({
  state,
  saveStatus,
  onBack,
  onRename,
  onTrash,
  onDownload,
}: {
  state: LoadState;
  saveStatus: SaveStatus;
  onBack: () => void;
  onRename: (name: string) => void;
  onTrash: () => void;
  onDownload: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const file = state.kind === "ready" ? state.file : null;

  return (
    <header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        borderBottom: "1px solid var(--line)",
        background: "var(--card)",
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Drive"
        data-testid="file-fullscreen-back"
        title="Back to Drive (Esc)"
        style={{
          padding: 6,
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--card)",
          cursor: "pointer",
          display: "inline-flex",
        }}
      >
        <ArrowLeft size={16} />
      </button>
      <FilenameField name={file?.name ?? "Loading…"} editable={!!file} onCommit={onRename} />
      <SaveStatusPill status={saveStatus} />
      <div style={{ flex: 1 }} />
      {file && (
        <>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share"
            data-testid="file-fullscreen-share"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--card)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--text)",
            }}
          >
            <Share2 size={14} />
            Share
          </button>
          <EntryKebab
            entry={{ kind: "file", file }}
            handlers={{
              onOpen: () => {},
              onRename: () => {
                document
                  .querySelector<HTMLElement>('[data-testid="file-fullscreen-title"]')
                  ?.click();
              },
              onTrash,
              onDownload,
            }}
          />
        </>
      )}
      <ShareDialog open={shareOpen} file={file} onClose={() => setShareOpen(false)} />
    </header>
  );
}

function FilenameField({
  name,
  editable,
  onCommit,
}: {
  name: string;
  editable: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(name);
            setEditing(false);
          }
        }}
        data-testid="file-fullscreen-title-input"
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: "var(--text)",
          background: "var(--bg)",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          padding: "4px 8px",
          outline: "none",
          minWidth: 220,
          maxWidth: 480,
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => editable && setEditing(true)}
      aria-label={editable ? `Rename ${name}` : name}
      data-testid="file-fullscreen-title"
      disabled={!editable}
      style={{
        fontSize: "var(--text-sm)",
        fontWeight: 600,
        color: "var(--text)",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: 6,
        padding: "4px 8px",
        cursor: editable ? "text" : "default",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: 480,
        textAlign: "left",
      }}
      onMouseOver={(e) => {
        if (editable) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {name}
    </button>
  );
}

function FullscreenBody({
  state,
  onSaveStatus,
}: {
  state: LoadState;
  onSaveStatus: (s: SaveStatus) => void;
}) {
  if (state.kind === "loading") {
    return (
      <div
        data-testid="file-fullscreen-loading"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--text-sm)",
          color: "var(--text-muted)",
        }}
      >
        Opening file…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        data-testid="file-fullscreen-error"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          Couldn't open this file
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420 }}>
          {state.message}
        </div>
      </div>
    );
  }

  const { file } = state;
  const kind = inferKind(file.name, file.content_type);

  if (kind === "doc") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CasualDocEditor file={file} mode="editor" onSaveStatus={onSaveStatus} />
      </Suspense>
    );
  }
  if (kind === "sheet") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CasualSheetWorkspace file={file} mode="editor" onSaveStatus={onSaveStatus} />
      </Suspense>
    );
  }

  // Every other kind — image / pdf / video / audio / text / md /
  // generic — falls through to PreviewStage. The fullscreen route
  // gets the same per-kind viewer the modal uses, just without the
  // surrounding modal chrome. PreviewStage already takes the full
  // available space so it scales correctly to the route layout.
  return (
    <div
      data-testid="file-fullscreen-viewer"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <Suspense fallback={<LoadingFallback />}>
        <PreviewStage file={file} kind={kind} />
      </Suspense>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "var(--text-sm)",
        color: "var(--text-muted)",
      }}
    >
      Loading editor…
    </div>
  );
}
