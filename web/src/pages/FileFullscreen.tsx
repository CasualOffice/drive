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
 *   - Co-edit: this page brokers a per-file collab room (GET
 *     /api/files/{id}/collab). Two transports, by kind:
 *       · plain-text (.md/.txt/…): `useCollabSession` opens a standalone
 *         `y-websocket` provider and `CodeTextEditor` binds a shared `Y.Text`.
 *       · `.docx` / `.xlsx` (P3): the SDK owns the provider. We fetch just the
 *         room *grant* via `useCollabGrant` and feed it to the editor's
 *         declarative `collab` prop — real CRDT sync + cursors + presence. The
 *         SDK reports presence back up (via `onPresence`) for the shared header
 *         indicator; we never open a second provider on the same room.
 *     A 404 / no collab server falls back to single-user editing, unchanged.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Info, RotateCw, Share2, X } from "lucide-react";
import { toast } from "sonner";

import {
  downloadUrl,
  errorText,
  getFile,
  renameFile,
  trashFile,
  type FileDto,
} from "../api/client.ts";
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
  DISABLED_SESSION,
  tintFor,
  useCollabGrant,
  useCollabSession,
  type CollabIdentity,
  type CollabSession,
} from "../lib/collab.ts";
import type { CollabRoom } from "../api/client.ts";

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

  // Always reconcile against the server on mount. The `history.state` seed
  // gives an instant first paint, but it can be STALE — e.g. the user restored
  // an older version on the `/history` route (bumping the head) and navigated
  // back here; the seed still holds the pre-restore version. Refetching keeps
  // the version chip + details proof line honest, and also covers the cold
  // load (refresh / shared URL / bookmark) where there's no seed at all.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = await getFile(fileId);
        if (cancelled) return;
        setState({ kind: "ready", file });
      } catch (err) {
        if (cancelled) return;
        // Keep a seeded view on a transient refetch failure; only surface an
        // error when we have nothing to show.
        setState((prev) =>
          prev.kind === "ready"
            ? prev
            : { kind: "error", message: errorText(err) },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Explicit retry for the error surface — a cold load with no seed that fails
  // is otherwise a dead end (the mount effect runs once). Re-enters the loading
  // state so the spinner returns, then refetches.
  const retry = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const file = await getFile(fileId);
      setState({ kind: "ready", file });
    } catch (err) {
      setState({ kind: "error", message: errorText(err) });
    }
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

  // Live co-editing room. Only editable surfaces join; viewers and non-editor
  // kinds stay single-user. Identity is published over awareness so peers
  // render in the presence indicator.
  const { status: authStatus } = useAuth();
  const file = state.kind === "ready" ? state.file : null;
  const kind = file ? inferKind(file.name, file.content_type) : null;
  const editable = kind ? isEditableKind(kind) : false;
  // Two collab transports, split by kind (see the module docblock):
  //   · text/md → standalone y-websocket provider (CodeTextEditor binds Y.Text)
  //   · doc/sheet → the SDK owns the provider; we only broker the room grant.
  // Splitting them keeps a single provider on each room (no ghost peer).
  const textKind = kind === "text" || kind === "md";
  const sdkKind = kind === "doc" || kind === "sheet";
  const identity = useMemo<CollabIdentity>(() => {
    const name = authStatus.kind === "authed" ? authStatus.me.admin : "You";
    const userId =
      (authStatus.kind === "authed" ? authStatus.me.user_id : null) ?? name ?? "anon";
    return { userId, name, tint: tintFor(userId), activity: "editing" };
  }, [authStatus]);

  // Plain-text co-editing: standalone provider + shared Y.Text.
  const session = useCollabSession(fileId, identity, { enabled: editable && textKind });
  // SDK editors: broker the room grant only (the SDK opens the provider).
  const { grant, resolved: grantResolved } = useCollabGrant(fileId, editable && sdkKind);
  // Presence lifted from the SDK's collab callbacks, for the shared header.
  const [sdkCollab, setSdkCollab] = useState<CollabSession>(DISABLED_SESSION);

  // The session that drives the header presence indicator, per transport.
  const headerCollab = textKind ? session : sdkKind ? sdkCollab : DISABLED_SESSION;

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
        collab={headerCollab}
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
          session={session}
          grant={grant}
          grantResolved={grantResolved}
          onPresence={setSdkCollab}
          user={{ name: identity.name, color: identity.tint }}
          onSaveStatus={setSaveStatus}
          onSaved={(file) => setState({ kind: "ready", file })}
          onRetry={retry}
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
      className="cd-fs-header"
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 52,
        padding: "0 16px",
        background: "var(--bg-surface)",
        borderBottom: "var(--border-w) solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Drive"
        data-testid="file-fullscreen-back"
        title="Back to Drive (Esc)"
        className="press-sink"
        style={{
          width: 30,
          height: 30,
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-surface)",
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
            height: 22,
            padding: "0 8px",
            fontSize: "var(--text-2xs)",
            fontWeight: "var(--weight-bold)",
            color: "var(--violet-500)",
            background: "var(--violet-100)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
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
            className="press-sink"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-bold)",
              color: "var(--fg-default)",
            }}
          >
            <Info size={14} strokeWidth={2} />
            Details
          </button>
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share"
            data-testid="file-fullscreen-share"
            className="press-sink-lg"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--violet-500)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-bold)",
              color: "var(--on-violet)",
            }}
          >
            <Share2 size={14} strokeWidth={2} />
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
          fontSize: "var(--text-md)",
          fontWeight: 700,
          color: "var(--fg-default)",
          background: "var(--bg-surface)",
          border: "var(--border-w) solid var(--violet-500)",
          borderRadius: "var(--radius-sm)",
          boxShadow: "2px 2px 0 0 var(--violet-500)",
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
        fontSize: "var(--text-md)",
        fontWeight: 700,
        color: "var(--fg-default)",
        background: "transparent",
        border: "var(--border-w) solid transparent",
        borderRadius: "var(--radius-sm)",
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
  session,
  grant,
  grantResolved,
  onPresence,
  user,
  onSaveStatus,
  onSaved,
  onRetry,
}: {
  state: LoadState;
  /** Standalone-provider session — plain-text editor only. */
  session: CollabSession;
  /** SDK-editor room grant (doc/sheet), or `null` when collab is off. */
  grant: CollabRoom | null;
  /** True once the grant broker call has settled — gate the SDK-editor mount
   *  on this so it doesn't import single-user content then re-attach collab. */
  grantResolved: boolean;
  /** Presence sink for the SDK editors → header indicator. */
  onPresence: (session: CollabSession) => void;
  /** Drive's signed-in user, threaded to the doc editor for authorship. */
  user: { name: string; color: string };
  onSaveStatus: (s: SaveStatus) => void;
  onSaved: (file: FileDto) => void;
  /** Re-run the file load from the error surface. */
  onRetry: () => void;
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
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
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
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-canvas)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            textAlign: "center",
            maxWidth: 460,
            padding: "28px 32px",
            background: "var(--bg-surface)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow)",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: "var(--text-md)",
              fontWeight: "var(--weight-bold)",
              color: "var(--danger)",
            }}
          >
            <AlertTriangle size={16} strokeWidth={2.2} aria-hidden />
            Couldn&apos;t open this file
          </span>
          <div style={{ fontSize: "var(--text-base)", color: "var(--ink-soft)" }}>
            {state.message}
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="press-sink"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
              padding: "8px 14px",
              border: "var(--border-w) solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--ink)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RotateCw size={14} strokeWidth={1.5} />
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { file } = state;
  const kind = inferKind(file.name, file.content_type);

  if (kind === "doc" || kind === "sheet") {
    // Gate the SDK-editor mount until the room grant resolves: mounting first
    // would import single-user content and then re-attach collab on top of it
    // (double-load / racey sync). Once resolved, `grant` is stable for the
    // file's lifetime, so the SDK attaches exactly once.
    if (!grantResolved) return <LoadingFallback />;
    if (kind === "doc") {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <CasualDocEditor
            file={file}
            mode="editor"
            onSaveStatus={onSaveStatus}
            user={user}
            collab={grant}
            onPresence={onPresence}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CasualSheetWorkspace
          file={file}
          mode="editor"
          onSaveStatus={onSaveStatus}
          user={user}
          collab={grant}
          onPresence={onPresence}
        />
      </Suspense>
    );
  }
  // P2.1 — the plain-text document kinds (.md/.txt/.csv/.json/.yaml) get
  // the light embedded editor; every save commits a new version through
  // the content endpoint, same contract as the SDK editors.
  if (kind === "text" || kind === "md") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <CodeTextEditor file={file} collab={session} onSaveStatus={onSaveStatus} onSaved={onSaved} />
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
      role="status"
      aria-label="Loading editor"
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
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow)",
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
          background: "var(--bg-overlay)",
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
            borderBottom: "var(--border-w) solid var(--border)",
          }}
        >
          <div style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--fg-default)" }}>
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
