/**
 * CasualSheetWorkspace — Drive's mount for `.xlsx` files via the
 * **direct React mount** of `<CasualSheets>` from
 * `@casualoffice/sheets@>=0.11.0` (the Excalidraw-model SDK).
 *
 * Why the direct mount (not the iframe wrapper anymore):
 *   - The SDK now ships its OWN Office chrome (`chrome="full"`: menu bar,
 *     formatting toolbar with font/size/colour/borders/align/merge/numfmt/
 *     AutoSum, formula bar, sheet tabs, status bar) wired to the imperative
 *     `CasualSheetsAPI`. The iframe `embed-runtime` deliberately renders only
 *     Univer's header (`{header:true, toolbar:false, footer:false}`) and does
 *     NOT expose `chrome="full"`, so via the iframe the host is forced to
 *     hand-roll a toolbar. Direct mount gives us the SDK chrome for free.
 *   - It sidesteps the iframe ref's `executeCommand(command)` boundary which
 *     drops `args` (so the old hand-rolled toolbar's font/size/colour buttons
 *     were no-ops on the iframe path). With `chrome="full"` the SDK drives
 *     those commands internally through the facade, with args intact.
 *   - Drive's web is a same-origin Vite SPA that already pins the full
 *     `@univerjs/*` 0.25 peer set, and externalises React via the SDK, so
 *     there's a single React + single Univer copy — the old `LocaleService`
 *     init crash (0.4.x) doesn't apply at 0.25.
 *
 * Persistence (the "host stores, the SDK never does" contract):
 *   - load: `DriveFileSource.open(id)` → xlsx bytes → `xlsxToWorkbookData`
 *     → `initialData`.
 *   - save: `onChange` (debounced autosave) / `onSave` (Ctrl/Cmd+S) /
 *     `onExit` (unmount) → `api.exportXlsx()` → `DriveFileSource.save(bytes)`.
 *   Drive's WOPI/auth/file handling (cookie + CSRF, `/api/files/{id}/content`)
 *   is fully preserved — only the editor-SDK integration changed.
 *
 * `preview` mode renders the bare grid (`chrome="none"`) read-only for the
 * Preview modal; `editor` mode renders the full SDK chrome.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { CasualSheets, type CasualSheetsAPI } from "@casualoffice/sheets/sheets";
import { xlsxToWorkbookData } from "@casualoffice/sheets/xlsx";
import "@casualoffice/sheets/styles";
import type { IWorkbookData } from "@univerjs/core";

import { type FileDto } from "../../api/client.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import { withSaveStatus, type OnSaveStatus } from "./save-status.ts";
import { SHEET_LOCALES } from "./sheet-locale.ts";

export interface IframeErrorData {
  code: "embed_not_served" | "load_failed" | "parse_failed" | "boot_failed" | "internal";
  message: string;
}

export interface CasualSheetWorkspaceProps {
  file: FileDto;
  /** `preview` = bare read-only grid (modal mount). `editor` = the SDK's
   *  full Office chrome (fullscreen route). */
  mode?: "preview" | "editor";
  /** Optional callback that fires on every save attempt. Drives the
   *  "Saving… / Saved / Failed" pill in `<FileFullscreen>`. */
  onSaveStatus?: OnSaveStatus;
  /** Fires when the workbook fails to load / parse. Drive's PreviewStage
   *  swaps the editor for a friendly fallback card so users never see a
   *  raw error UI. */
  onError?: (data: IframeErrorData) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: IWorkbookData }
  | { kind: "error" };

export function CasualSheetWorkspace({
  file,
  mode = "preview",
  onSaveStatus,
  onError,
}: CasualSheetWorkspaceProps) {
  // Latch callbacks so the file-source / persistence memo doesn't churn
  // when the host re-renders for an unrelated reason. The host can swap
  // the functions freely — the bound closures always call the current one.
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // One DriveFileSource per open file — owns the authenticated load/save
  // round-trip against `/api/files/{id}/content`. Wrap save() so every
  // transition drives the host's save-status pill.
  const fileSource = useMemo(() => {
    const fs = new DriveFileSource(file);
    const rawSave = async (docId: string, bytes: ArrayBuffer, opts?: { etag?: string }) =>
      fs.save(docId, bytes, opts);
    const save = withSaveStatus(rawSave, (s) => onSaveStatusRef.current?.(s));
    return { open: (id: string) => fs.open(id), save };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  // Load the bytes once per file, convert xlsx → IWorkbookData, then mount
  // <CasualSheets> with that snapshot. The SDK reads `initialData` once on
  // mount, so we resolve it up front rather than swapping it after.
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const { bytes } = await fileSource.open(file.id);
        const data = await xlsxToWorkbookData(bytes);
        if (cancelled) return;
        setLoad({ kind: "ready", data });
      } catch (err) {
        if (cancelled) return;
        setLoad({ kind: "error" });
        onErrorRef.current?.({
          code: "load_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, fileSource]);

  // Hold the imperative API so onChange/onSave/onExit can export + persist.
  const apiRef = useRef<CasualSheetsAPI | null>(null);

  // Export the live workbook to xlsx and persist it through the file source.
  // Shared by autosave (onChange), explicit save (onSave), and exit.
  const persist = useMemo(() => {
    let inFlight = false;
    return async () => {
      const api = apiRef.current;
      if (!api || inFlight) return;
      inFlight = true;
      try {
        const blob = await api.exportXlsx();
        const bytes = await blob.arrayBuffer();
        await fileSource.save(file.id, bytes);
      } catch {
        // withSaveStatus already surfaced the failure to the pill; swallow
        // here so a transient save error doesn't crash the editor.
      } finally {
        inFlight = false;
      }
    };
  }, [file.id, fileSource]);

  if (load.kind === "loading") {
    return (
      <div
        data-testid="casual-sheet-workspace-loading"
        style={fillCenter("var(--text-muted, #5a5a5a)")}
      >
        Loading workbook…
      </div>
    );
  }

  if (load.kind === "error") {
    // The host (PreviewStage / FileFullscreen) renders its own fallback via
    // onError. Keep a minimal in-place surface too so a host that doesn't
    // pass onError still gets a terminal state (and the e2e smoke has a
    // stable hook).
    return (
      <div data-testid="casual-sheet-workspace-error" style={fillCenter("var(--danger, #d63a2f)")}>
        Couldn&apos;t load this workbook.
      </div>
    );
  }

  if (mode === "preview") {
    // Read-only bare grid for the Preview modal. No persistence wiring —
    // the modal is a viewer.
    return (
      <div data-testid="casual-sheet-workspace" style={{ width: "100%", height: "100%" }}>
        <CasualSheets
          initialData={load.data}
          chrome="none"
          locales={SHEET_LOCALES}
          lazyPlugins={false}
          ui={{ header: false, toolbar: false, footer: false, contextMenu: false }}
        />
      </div>
    );
  }

  // Full editor — the SDK's own Office chrome (menu bar + toolbar + formula
  // bar + sheet tabs + status bar), with host-owned persistence.
  return (
    <div
      data-testid="casual-sheet-workspace"
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      <CasualSheets
        initialData={load.data}
        chrome="full"
        locales={SHEET_LOCALES}
        lazyPlugins={false}
        onReady={(api) => {
          apiRef.current = api;
        }}
        onChange={() => void persist()}
        onSave={() => void persist()}
        onExit={() => void persist()}
      />
    </div>
  );
}

function fillCenter(color: string): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    color,
  };
}
