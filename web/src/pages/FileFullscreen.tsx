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
 *   - Co-edit: P2.3 wires a live collab room here via `useCollabSession`
 *     (GET /api/files/{id}/collab → Yjs `y-websocket`). The plain-text
 *     editor binds a shared `Y.Text` for true co-editing; the SDK iframe
 *     editors consume the session for the presence indicator only (their
 *     CRDT lives behind the iframe protocol — a follow-up). A 404 / no
 *     collab server falls back to single-user editing, unchanged.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Info, Share2, X } from "lucide-react";
import { toast } from "sonner";

import { downloadUrl, getFile, renameFile, trashFile, type FileDto } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { DetailsPanel } from "../components/DetailsPanel.tsx";
import { EntryKebab } from "../components/EntryMenu.tsx";
import { FilePresenceStack } from "../components/FilePresenceStack.tsx";
import { inferKind } from "../components/FileThumb.tsx";
import { CollabPresence } from "../components/editor/CollabPresence.tsx";
import { SaveStatusPill } from "../components/editor/SaveStatusPill.tsx";
import type { SaveStatus } from "../components/editor/save-status.ts";
import { ShareDialog } from "../components/ShareDialog.tsx";
import { useReportViewing } from "../state/PresenceContext.tsx";
import {
  tintFor,
  useCollabSession,
  type CollabIdentity,
  type CollabSession,
} from "../lib/collab.ts";

/** Editor surfaces that host a live editing session (and thus a collab
 *  room). Viewers (pdf / generic preview) get no room. */
function isEditableKind(kind: string): boolean {
  return kind === "doc" || kind === "sheet" || kind === "text" || kind === "md";
}

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
// P2.1 — the light embedded editor for the plain-text document kinds
// (.md/.txt/.csv/.json/.yaml). Loads head bytes + saves each commit as
// a new version through the same content endpoint the SDK editors use.
const CodeTextEditor = lazy(() =>
  import("../components/editor/CodeTextEditor.tsx").then((m) => ({
    default: m.CodeTextEditor,
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
    document.title = `${state.file.name} — Doc-Hub`;
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

  // P2.3 — live co-editing room. Only editable surfaces join; viewers and
  // non-editor kinds stay `disabled` (single-user). Identity is published
  // over Yjs awareness so peers render in the presence indicator.
  const { status: authStatus } = useAuth();
  const file = state.kind === "ready" ? state.file : null;
  const editable = file ? isEditableKind(inferKind(file.name, file.content_type)) : false;
  const identity = useMemo<CollabIdentity>(() => {
    const name = authStatus.kind === "authed" ? authStatus.me.admin : "You";
    const userId =
      (authStatus.kind === "authed" ? authStatus.me.user_id : null) ?? name ?? "anon";
    return { userId, name, tint: tintFor(userId), activity: "editing" };
  }, [authStatus]);
  const collab = useCollabSession(fileId, identity, { enabled: editable });

  // Details drawer state — opens via the header Details pill, slides
  // in from the right edge with the same DetailsPanel the modal uses.
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      data-testid="file-fullscreen"
      data-file-id={fileId}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-canvas)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FullscreenHeader
        state={state}
        saveStatus={saveStatus}
        collab={collab}
        onBack={goBack}
        onRename={onRename}
        onOpenDetails={() => setDetailsOpen(true)}
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
        <FullscreenBody
          state={state}
          collab={collab}
          user={{ name: identity.name, color: identity.tint }}
          onSaveStatus={setSaveStatus}
          onSaved={(file) => setState({ kind: "ready", file })}
        />
      </main>
      {state.kind === "ready" && (
        <DetailsDrawer file={state.file} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      )}
    </div>
  );
}

function FullscreenHeader({
  state,
  saveStatus,
  collab,
  onBack,
  onRename,
  onOpenDetails,
  onTrash,
  onDownload,
}: {
  state: LoadState;
  saveStatus: SaveStatus;
  collab: CollabSession;
  onBack: () => void;
  onRename: (name: string) => void;
  onOpenDetails: () => void;
  onTrash: () => void;
  onDownload: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const file = state.kind === "ready" ? state.file : null;

  return (
    <header
      className="glass--thin"
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 48,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-hair)",
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Drive"
        data-testid="file-fullscreen-back"
        title="Back to Drive (Esc)"
        style={{
          width: 28,
          height: 28,
          border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-raised)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--fg-default)",
        }}
      >
        <ArrowLeft size={16} strokeWidth={1.5} />
      </button>
      <FilenameField name={file?.name ?? "Loading…"} editable={!!file} onCommit={onRename} />
      {file && file.version > 0 && (
        <button
          type="button"
          className="mono"
          data-testid="file-fullscreen-version-chip"
          title="Version history"
          onClick={() => {
            const url = `/document/${encodeURIComponent(file.id)}/history`;
            window.history.pushState({ file }, "", url);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 18,
            padding: "0 6px",
            fontSize: "var(--text-2xs)",
            color: "var(--fg-muted)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-hair)",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = "var(--fg-default)";
            e.currentTarget.style.borderColor = "var(--border-strong)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = "var(--fg-muted)";
            e.currentTarget.style.borderColor = "var(--border-hair)";
          }}
        >
          v{file.version}
        </button>
      )}
      <SaveStatusPill status={saveStatus} />
      <div style={{ flex: 1 }} />
      <CollabPresence session={collab} />
      <FilePresenceStack fileId={file?.id} />
      {file && (
        <>
          <button
            type="button"
            onClick={onOpenDetails}
            aria-label="File details"
            title="File details"
            data-testid="file-fullscreen-details"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 12px",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-raised)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: "var(--fg-default)",
            }}
          >
            <Info size={14} strokeWidth={1.5} />
            Details
          </button>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share"
            data-testid="file-fullscreen-share"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 12px",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-raised)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: "var(--fg-default)",
            }}
          >
            <Share2 size={14} strokeWidth={1.5} />
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
              onHistory: () => {
                const url = `/document/${encodeURIComponent(file.id)}/history`;
                window.history.pushState({ file }, "", url);
                window.dispatchEvent(new PopStateEvent("popstate"));
              },
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
          color: "var(--fg-default)",
          background: "var(--bg-canvas)",
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
        color: "var(--fg-default)",
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
  collab,
  user,
  onSaveStatus,
  onSaved,
}: {
  state: LoadState;
  collab: CollabSession;
  /** Drive's signed-in user, threaded to the doc editor for authorship. */
  user: { name: string; color: string };
  onSaveStatus: (s: SaveStatus) => void;
  onSaved: (file: FileDto) => void;
}) {
  if (state.kind === "loading") {
    return (
      <div
        data-testid="file-fullscreen-loading"
        role="status"
        aria-label="Opening file"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          boxSizing: "border-box",
          background: "var(--bg-canvas)",
        }}
      >
        <div
          style={{
            width: "min(640px, 100%)",
            height: "min(100%, 520px)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-hair)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sm)",
            padding: "32px clamp(20px, 6vw, 44px)",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflow: "hidden",
          }}
        >
          <div className="skeleton" style={{ height: 20, width: "48%", borderRadius: "var(--radius-xs)", marginBottom: 8 }} />
          {["96%", "88%", "92%", "70%", "94%", "82%", "90%", "58%"].map((w, i) => (
            <div key={i} className="skeleton" style={{ height: 11, width: w, borderRadius: "var(--radius-2xs)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        data-testid="file-fullscreen-error"
        role="alert"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: 24,
          textAlign: "center",
          background: "var(--bg-canvas)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--status-danger-700)",
          }}
        >
          <AlertTriangle size={16} strokeWidth={1.5} aria-hidden />
          Couldn&apos;t open this file
        </span>
        <div style={{ fontSize: "var(--text-base)", color: "var(--fg-muted)", maxWidth: 420 }}>
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
        <CasualDocEditor file={file} mode="editor" onSaveStatus={onSaveStatus} user={user} />
      </Suspense>
    );
  }
  if (kind === "sheet") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CasualSheetWorkspace file={file} mode="editor" onSaveStatus={onSaveStatus} user={user} />
      </Suspense>
    );
  }
  // P2.1 — the plain-text document kinds (.md/.txt/.csv/.json/.yaml) get
  // the light embedded editor; every save commits a new version through
  // the content endpoint, same contract as the SDK editors.
  if (kind === "text" || kind === "md") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CodeTextEditor file={file} collab={collab} onSaveStatus={onSaveStatus} onSaved={onSaved} />
      </Suspense>
    );
  }

  // Every remaining document kind — pdf / generic / opaque — falls
  // through to PreviewStage (documents-only; no media renderers).
  // The fullscreen route gets the same per-kind viewer the modal uses,
  // just without the surrounding modal chrome. PreviewStage fills the
  // available space and owns its own scroll + padding.
  return (
    <div
      data-testid="file-fullscreen-viewer"
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-canvas)",
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
        color: "var(--fg-muted)",
      }}
    >
      Loading editor…
    </div>
  );
}

/** Right-edge slide-in drawer that hosts the shared DetailsPanel from
 *  the Preview modal. 360 px wide, slides in over the editor. Close on
 *  Esc, on backdrop click, or via the X button. Designed to feel like
 *  Google Docs' "Document details" side panel — accessible alongside
 *  the editor without forcing a navigation. */
function DetailsDrawer({
  file,
  open,
  onClose,
}: {
  file: FileDto;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.18)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
          zIndex: 90,
          animation: "cd-details-fade 180ms ease-out",
        }}
      />
      <aside
        role="dialog"
        aria-label="File details"
        data-testid="file-fullscreen-details-drawer"
        className="glass"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          maxWidth: "92vw",
          // Flush right edge — glass owns the fill/border/shadow; drop the
          // rounded corners so the drawer meets the viewport cleanly.
          borderRadius: 0,
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          animation: "cd-details-slide 220ms cubic-bezier(.2,.7,.2,1)",
        }}
      >
        <header
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--fg-default)" }}>
            Details
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            data-testid="file-fullscreen-details-close"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              padding: 4,
              borderRadius: 6,
              display: "inline-flex",
            }}
          >
            <X size={16} />
          </button>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          <DetailsPanel file={file} />
        </div>
      </aside>
      <style>{`
        @keyframes cd-details-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cd-details-slide {
          from { transform: translateX(24px); opacity: 0.4; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
