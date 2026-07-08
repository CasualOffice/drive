/**
 * CasualSheetWorkspace — Drive's mount for `.xlsx` files. Renders the in-app
 * React `<CasualSheets>` from `@casualoffice/sheets` DIRECTLY into Drive's
 * tree (no iframe seam). Phase 2 of the native-SDK integration — the peer of
 * `<CasualDocEditor>` (P1), retiring the ~300-line bespoke `<SheetEmbed>`
 * iframe host + `EmbedHostTransport` postMessage glue.
 *
 * Why the direct mount (replacing the old `<SheetEmbed>` iframe):
 *   - No iframe seam. The spreadsheet shares Drive's viewport, scroll, focus,
 *     theme and design surface, so `.xlsx` editing feels fully native inside
 *     Drive's own fullscreen chrome (titlebar / back / share / save-status /
 *     presence all live in `<FileFullscreen>`, not in a nested frame).
 *   - Single React runtime. `<CasualSheets>` initialises Univer itself
 *     (locale + theme + plugin set); React is a deduped peer shared with the
 *     SDK. The old "LocaleService: Locale not initialized" crash the iframe
 *     guarded against is owned by the SDK now — it sets locale on the workbook
 *     unit before the render engine reads it.
 *
 * Chrome (native feel, via `chrome` + `documentMode`):
 *   - `mode="editor"`  → `documentMode="editing"` + `chrome="full"`: the SDK's
 *     Office shell — menu bar, formatting toolbar, formula bar + name box,
 *     worksheet tab strip, and the status bar (Sum/Avg/Count + zoom). None of
 *     these duplicate Drive's fullscreen header (which is file-level: title,
 *     save state, version, share), so — unlike the docs editor, whose status
 *     bar showed a redundant save pill — nothing is hidden here: the sheet
 *     status bar (aggregate stats + zoom) is a core spreadsheet affordance
 *     users expect (matches Google Sheets), not chrome Drive re-provides.
 *   - `mode="preview"` → `documentMode="viewing"` (read-only via the SDK's
 *     `applyReadOnly` command-veto) + `chrome="none"`: JUST the rendered grid
 *     for the Preview modal / read-only fullscreen viewer.
 *
 * Persistence (host owns storage; SDK never does): the wrapper fetches the
 * file's `.xlsx` bytes via `DriveFileSource.open(id)` on mount and hands them
 * to `api.importXlsx(bytes)` in `onReady` (the SDK's full-fidelity import —
 * values/formulas, styles, merges, number formats, borders, hyperlinks,
 * comments, data validation, tables, page setup, and VBA/pivot/drawing
 * passthrough). In editor mode it persists on every settled edit + on Ctrl/Cmd+S
 * via `api.exportXlsx()` → `DriveFileSource.save()` (`PUT /api/files/{id}/content`,
 * cookie + CSRF, version-as-etag). `save()` is wrapped in `withSaveStatus` so
 * every round-trip drives the "Saving… / Saved / Failed" pill in
 * `<FileFullscreen>`.
 *
 * Bundle: Univer + the `@univerjs/*` plugin set is heavy (~9 MB). Both callers
 * (`FileFullscreen`, `PreviewStage`) `React.lazy`-wrap this component, so the
 * whole Univer graph lands in an async `vendor-univer-sheets` chunk pulled only
 * when a `.xlsx` is actually opened — the file browser stays fast.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Import from the `/sheets` subpath (the Univer-coupled editor surface) rather
// than the bare-index barrel, which also re-exports the signing / embed-protocol
// modules. The barrel makes Rollup pull those Univer-free re-exports into the
// same manual chunk and static-link it to the entry, eagerly loading all of
// Univer on first paint. The subpath keeps the whole graph behind React.lazy.
import { CasualSheets, setMentionProvider, type CasualSheetsAPI } from "@casualoffice/sheets/sheets";
import "@casualoffice/sheets/styles";
// The cell-comment @-mention popup is powered by @univerjs/docs-mention-ui,
// whose styles ship as a SEPARATE stylesheet the sheets SDK's `/styles` barrel
// does NOT bundle (it imports design/ui/docs-ui/sheets-ui/formula/numfmt only).
// Without this the mention dropdown renders unstyled (raw list, no card /
// hover / rounded surface). Side-effect import right next to the mount.
import "@univerjs/docs-mention-ui/lib/index.css";
// Type-only import (erased at build) — the concrete collab runtime lives on the
// SDK's own chunk, pulled in by the `collab` prop, not by this host wrapper.
import type { AttachCollabOptions, CollabConnectionStatus } from "@casualoffice/sheets/collab";
import { LocaleType, type IWorkbookData } from "@univerjs/core";

import { type CollabRoom, type FileDto } from "../../api/client.ts";
import { resolveAppearance, subscribeAppearance } from "../../lib/appearance.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import {
  DISABLED_SESSION,
  presenceSession,
  type CollabSession,
  type CollabStatus,
} from "../../lib/collab.ts";
import { withSaveStatus, type OnSaveStatus } from "./save-status.ts";
import { SHEET_LOCALES } from "./sheet-locale.ts";

/** Map the sheets SDK's connection status onto the shared header's vocabulary. */
function mapSheetStatus(status: CollabConnectionStatus): CollabStatus {
  return status === "live" ? "connected" : status === "connecting" ? "connecting" : "disconnected";
}

export interface CasualSheetWorkspaceProps {
  file: FileDto;
  /** `preview` = read-only viewer, no chrome, just the grid (modal mount).
   *  `editor` = full editing with the SDK's Office chrome (fullscreen route). */
  mode?: "preview" | "editor";
  /** Fires on every save attempt. Drives the "Saving… / Saved / Failed"
   *  pill in `<FileFullscreen>`. */
  onSaveStatus?: OnSaveStatus;
  /** Fires when the workbook fails to load / parse / boot so Drive's
   *  PreviewStage can swap in a friendly fallback card. SDK-native `(error:
   *  Error)` shape — same as `<CasualDocEditor onError>` — so both mounts remap
   *  identically to Drive's on-brand `<ErrorState>` fallback. */
  onError?: (error: Error) => void;
  /** Drive's signed-in user — threaded for symmetry with the doc editor.
   *  `<CasualSheets>` has no author prop, so this is surfaced through the
   *  comment @-mention provider (self as a candidate) rather than a byline. */
  user?: { name: string; color: string };
  /** P3 — a live co-editing room grant (`{ ws_url, room, token }`) minted by
   *  `GET /api/files/{id}/collab`. When present (and `mode="editor"`) the SDK
   *  attaches its Yjs/Hocuspocus bridge and the (server-seeded) room becomes
   *  the source of truth — so we DON'T `importXlsx` over it. `null` (collab
   *  disabled / declined) ⇒ single-user editing via `importXlsx`, unchanged. */
  collab?: CollabRoom | null;
  /** Fires with the SDK's live connection status, mapped to a `CollabSession`
   *  for the shared `<CollabPresence>` header. The declarative `collab` prop
   *  surfaces `onStatus` (connection state) but not the peer roster, so peers
   *  stay empty here — the header shows Live/Connecting; per-cursor presence is
   *  painted in-grid by the SDK. Called with `DISABLED_SESSION` on unmount. */
  onPresence?: (session: CollabSession) => void;
}

/** A minimal single-sheet workbook used as the mount seed. Real content is
 *  loaded over it via `api.importXlsx` in `onReady`; only a genuinely blank /
 *  new file (zero bytes) keeps this as-is. */
function emptyWorkbook(name: string): IWorkbookData {
  return {
    id: `drive-${Date.now().toString(36)}`,
    name,
    appVersion: "",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: ["sheet-01"],
    sheets: {
      "sheet-01": {
        id: "sheet-01",
        name: "Sheet1",
        cellData: {},
        rowCount: 1000,
        columnCount: 26,
      },
    },
    resources: [],
  };
}

type Phase =
  | { kind: "fetching" }
  | { kind: "ready"; bytes: ArrayBuffer | null }
  | { kind: "error" };

export function CasualSheetWorkspace({
  file,
  mode = "preview",
  onSaveStatus,
  onError,
  user,
  collab,
  onPresence,
}: CasualSheetWorkspaceProps) {
  const isEditor = mode === "editor";
  // P3 — co-editing is live only in the editor surface when Drive brokered a
  // room grant. When active, the server-seeded Yjs room is the source of truth,
  // so `onReady` must NOT `importXlsx` on top of the bridge-synced content.
  const collabActive = isEditor && !!collab;

  // Latch callbacks so the memoised file source / persist closure don't churn
  // when the host re-renders for an unrelated reason.
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPresenceRef = useRef(onPresence);
  onPresenceRef.current = onPresence;

  const emitError = useCallback((err: unknown) => {
    onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
  }, []);

  // One DriveFileSource per open document; save() wrapped so each attempt
  // announces transitions to the host's save-status pill (same pattern as
  // CasualDocEditor).
  const source = useMemo(() => {
    const fs = new DriveFileSource(file);
    const originalSave = fs.save.bind(fs);
    fs.save = withSaveStatus(originalSave, (s) => onSaveStatusRef.current?.(s));
    return fs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const [phase, setPhase] = useState<Phase>({ kind: "fetching" });
  // Overlay the mounted grid with a skeleton until the initial import settles,
  // so users never see the empty seed workbook flash before their data lands.
  const [importing, setImporting] = useState(true);
  const [appearance, setAppearance] = useState(resolveAppearance);

  const apiRef = useRef<CasualSheetsAPI | null>(null);
  // Gate autosave: mutations fired BY the initial import must not trigger a
  // pointless save-back of the file we just opened. Flipped true once the
  // import settles.
  const readyToPersist = useRef(false);
  // User-dirty gate. Import / setContent clear the SDK's dirty flag, so
  // `onDirtyChange(true)` fires only on a genuine user edit — persisting on
  // that (not on every structural onChange) avoids a version bump just from
  // opening a file.
  const dirty = useRef(false);
  // Latch the fetched bytes for onReady (which closes over mount-time state).
  const bytesRef = useRef<ArrayBuffer | null>(null);

  // Fetch the workbook bytes on mount / file change.
  useEffect(() => {
    let cancelled = false;
    readyToPersist.current = false;
    setImporting(true);
    setPhase({ kind: "fetching" });
    (async () => {
      try {
        const { bytes } = await source.open(file.id);
        if (cancelled) return;
        const seed = bytes && bytes.byteLength > 0 ? bytes : null;
        // Empty bytes: in the editor, start a fresh blank sheet (new-file UX).
        // In the read-only preview there's nothing to show — surface the
        // friendly fallback rather than a blank grid.
        if (!seed && !isEditor) {
          emitError(new Error("This spreadsheet is empty."));
          setPhase({ kind: "error" });
          return;
        }
        bytesRef.current = seed;
        setPhase({ kind: "ready", bytes: seed });
        // No bytes to import (blank/new sheet) → nothing to overlay.
        if (!seed) {
          setImporting(false);
          readyToPersist.current = true;
        }
      } catch (err) {
        if (cancelled) return;
        emitError(err);
        setPhase({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, source, emitError, isEditor]);

  // Thread Drive's signed-in user into the SDK's only author-aware seam: the
  // comment @-mention provider. `<CasualSheets>` has no author/byline prop, so
  // this is how "who am I" reaches the editor — @-mentioning in a cell comment
  // lists the current user. Last-writer-wins global; cleared on unmount.
  const userName = user?.name;
  useEffect(() => {
    if (!userName) return;
    setMentionProvider((search) => {
      const term = search.replace(/^@/, "").toLowerCase();
      const self = { id: userName, label: userName };
      return term && !userName.toLowerCase().includes(term) ? [] : [self];
    });
    return () => setMentionProvider(null);
  }, [userName]);

  // Mirror Drive's resolved light/dark into the editor's `appearance` prop.
  // Follows both the ThemeToggle flipping `data-theme` AND (in system mode) the
  // OS preference changing, so the grid re-themes live in either case.
  useEffect(() => subscribeAppearance(setAppearance), []);

  const onReady = useCallback(
    async (api: CasualSheetsAPI) => {
      apiRef.current = api;
      try {
        // Under collab the room (seeded server-side from the file via
        // `GET /api/files/{id}/collab/seed`) is the source of truth: the SDK's
        // attachCollab bridge streams that content into the workbook. Importing
        // the file bytes on top would double-load and race the sync, so skip it.
        // Single-user (no grant) keeps the full-fidelity importXlsx path.
        if (!collabActive && bytesRef.current && bytesRef.current.byteLength > 0) {
          await api.importXlsx(bytesRef.current);
        }
      } catch (err) {
        emitError(err);
        setPhase({ kind: "error" });
        return;
      } finally {
        setImporting(false);
      }
      // Only after the initial content is in place do we allow autosave.
      readyToPersist.current = true;
    },
    [emitError, collabActive],
  );

  // P3 — declarative collab options for the SDK. `room` is the file id (Drive's
  // per-file room); `token` is the HMAC JWT the collab server's onAuthenticate
  // hook validates. `onStatus` drives the shared header indicator; `onSnapshot`
  // swaps the workbook when a peer's compaction snapshot arrives.
  const collabOpts = useMemo<AttachCollabOptions | undefined>(() => {
    if (!collabActive || !collab) return undefined;
    return {
      server: collab.ws_url,
      room: file.id,
      token: collab.token,
      onStatus: (status) => {
        onPresenceRef.current?.(presenceSession(mapSheetStatus(status), []));
      },
      onSnapshot: (wb) => {
        apiRef.current?.loadSnapshot(wb);
      },
    };
  }, [collabActive, collab, file.id]);

  // Reset the header indicator when collab is off / on unmount.
  useEffect(() => {
    if (collabOpts) return;
    onPresenceRef.current?.(DISABLED_SESSION);
    return () => onPresenceRef.current?.(DISABLED_SESSION);
  }, [collabOpts]);

  // Persist the current workbook: export to .xlsx via the SDK's full-fidelity
  // exporter, then PUT through DriveFileSource. Guarded so import-time
  // mutations and the read-only preview mount never write.
  const persist = useCallback(async () => {
    if (!isEditor || !readyToPersist.current || !dirty.current) return;
    const api = apiRef.current;
    if (!api) return;
    try {
      const blob = await api.exportXlsx();
      const bytes = await blob.arrayBuffer();
      // withSaveStatus (wrapping fs.save) drives the Saving…/Saved/Failed pill.
      await source.save(file.id, bytes);
    } catch (err) {
      // save-status already reported 'failed'; surface a boot/runtime error too
      // so a host that watches onError can react. Non-fatal — editing continues.
      emitError(err);
    }
  }, [isEditor, source, file.id, emitError]);

  if (phase.kind === "error") {
    // Editor-mode host (FileFullscreen) has no error swap, so render a minimal
    // inline notice; the preview host swaps via onError before this shows.
    return (
      <div
        data-testid="casual-sheet-workspace-error"
        role="alert"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          fontSize: "var(--text-sm)",
          color: "var(--fg-muted)",
          background: "var(--bg-canvas)",
        }}
      >
        Couldn&apos;t open this spreadsheet.
      </div>
    );
  }

  if (phase.kind === "fetching") {
    return <SheetSkeleton />;
  }

  return (
    <div
      data-testid="casual-sheet-workspace"
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}
    >
      <CasualSheets
        initialData={emptyWorkbook(file.name)}
        // Univer's LocaleService needs the string bundle up front or the render
        // engine throws "Locale not initialized" and never paints the grid.
        locale={LocaleType.EN_US}
        locales={SHEET_LOCALES}
        documentMode={isEditor ? "editing" : "viewing"}
        chrome={isEditor ? "full" : "none"}
        appearance={appearance}
        // P3 — real CRDT co-editing. The SDK attaches Yjs/Hocuspocus after
        // onReady and detaches on unmount; undefined ⇒ single-user grid.
        collab={collabOpts}
        onReady={onReady}
        // Persist on every settled edit (autosave) + on explicit Ctrl/Cmd+S,
        // editor mode only. Both funnel through the same guarded persist().
        onChange={isEditor ? persist : undefined}
        onChangeDebounceMs={1500}
        onSave={isEditor ? persist : undefined}
        onDirtyChange={(d) => {
          dirty.current = d;
        }}
        onError={(err) => {
          emitError(err);
          setPhase({ kind: "error" });
        }}
        style={{ width: "100%", height: "100%" }}
        testId="casual-sheets"
      />
      {importing && (
        <div
          data-testid="casual-sheet-workspace-loading"
          role="status"
          aria-label="Opening spreadsheet"
          style={{ position: "absolute", inset: 0, zIndex: 2 }}
        >
          <SheetSkeleton />
        </div>
      )}
    </div>
  );
}

/** Grid-shaped loading skeleton (content skeleton, not a spinner) shown while
 *  bytes fetch + the initial import settle. */
function SheetSkeleton() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "var(--bg-surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        className="skeleton"
        style={{ height: 38, width: "100%", borderRadius: 0, flex: "0 0 auto" }}
      />
      <div style={{ flex: 1, minHeight: 0, padding: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 22, width: "100%", borderRadius: 0 }} />
        ))}
      </div>
    </div>
  );
}
