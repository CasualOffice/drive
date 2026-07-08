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
import { LocaleType, type IWorkbookData } from "@univerjs/core";

import { type FileDto } from "../../api/client.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import { withSaveStatus, type OnSaveStatus } from "./save-status.ts";
import { SHEET_LOCALES } from "./sheet-locale.ts";

/** Error surfaced to the host so Drive can swap in a friendly fallback card
 *  instead of a raw editor error. Kept as `{ code, message }` — the shape the
 *  retired `<SheetEmbed>` used — so host call sites keep compiling. */
export interface SheetWorkspaceError {
  code: "load_failed" | "parse_failed" | "boot_failed" | "internal";
  message: string;
}

/** Re-export under the old name so host call sites that referenced the
 *  workspace's error type keep compiling. */
export type IframeErrorData = SheetWorkspaceError;

export interface CasualSheetWorkspaceProps {
  file: FileDto;
  /** `preview` = read-only viewer, no chrome, just the grid (modal mount).
   *  `editor` = full editing with the SDK's Office chrome (fullscreen route). */
  mode?: "preview" | "editor";
  /** Fires on every save attempt. Drives the "Saving… / Saved / Failed"
   *  pill in `<FileFullscreen>`. */
  onSaveStatus?: OnSaveStatus;
  /** Fires when the workbook fails to load / parse / boot so Drive's
   *  PreviewStage can swap in a friendly fallback card. */
  onError?: (data: IframeErrorData) => void;
  /** Drive's signed-in user — threaded for symmetry with the doc editor.
   *  `<CasualSheets>` has no author prop, so this is surfaced through the
   *  comment @-mention provider (self as a candidate) rather than a byline. */
  user?: { name: string; color: string };
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

/** Drive's current appearance, read from the `data-theme` attribute ThemeToggle
 *  writes on `<html>`. `<CasualSheets appearance>` is reactive, so this seeds
 *  the mount and the observer below re-themes on live toggles. */
function currentAppearance(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
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
}: CasualSheetWorkspaceProps) {
  const isEditor = mode === "editor";

  // Latch callbacks so the memoised file source / persist closure don't churn
  // when the host re-renders for an unrelated reason.
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const emitError = useCallback((err: unknown, code: SheetWorkspaceError["code"]) => {
    const message = err instanceof Error ? err.message : String(err);
    onErrorRef.current?.({ code, message });
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
  const [appearance, setAppearance] = useState<"light" | "dark">(() => currentAppearance());

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
          emitError(new Error("empty workbook"), "load_failed");
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
        emitError(err, "load_failed");
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

  // Mirror Drive's light/dark into the editor: ThemeToggle flips `data-theme`
  // on <html>; forward each change so the sheet re-themes live.
  useEffect(() => {
    const obs = new MutationObserver(() => setAppearance(currentAppearance()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const onReady = useCallback(
    async (api: CasualSheetsAPI) => {
      apiRef.current = api;
      try {
        if (bytesRef.current && bytesRef.current.byteLength > 0) {
          await api.importXlsx(bytesRef.current);
        }
      } catch (err) {
        emitError(err, "parse_failed");
        setPhase({ kind: "error" });
        return;
      } finally {
        setImporting(false);
      }
      // Only after the initial content is in place do we allow autosave.
      readyToPersist.current = true;
    },
    [emitError],
  );

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
      emitError(err, "internal");
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
          emitError(err, "boot_failed");
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
