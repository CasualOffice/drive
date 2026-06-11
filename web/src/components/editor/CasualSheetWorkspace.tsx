/**
 * CasualSheetWorkspace — Drive's mount for `.xlsx` files via the
 * `@schnsrw/casual-sheets` SDK. Replaces the Phase-1 placeholder
 * (`"Inline sheet editing — coming in v0.2"`) now that
 * `@schnsrw/casual-sheets@0.4.0` exposes `xlsxToWorkbookData` on the
 * `/xlsx` subpath.
 *
 * Two modes (`mode` prop):
 *   - `'preview'` (default) — chrome OFF. No toolbar / header / footer.
 *     Used by `PreviewModal`'s stage; gives a clean rendering of the
 *     workbook without distracting Office chrome. Editing inside cells
 *     still works (Univer's grid is interactive) — but autosave is
 *     OFF in preview, so anything typed is local-only and gone on
 *     close. This matches Google Drive / Dropbox preview behaviour.
 *   - `'editor'` — toolbar / header / footer ON. Used by the fullscreen
 *     `/file/<id>` route. Autosave round-trips edits back to Drive via
 *     `DriveFileSource.save()`.
 *
 * Bytes flow:
 *   1. Mount → `DriveFileSource.open(fileId)` → `ArrayBuffer`.
 *   2. `xlsxToWorkbookData(buffer)` (runs the parser in a Web Worker
 *      bundled inside the SDK; ~1.5 MB lazy chunk).
 *   3. `<CasualSheets initialData={data} ui={...}>` mounts the grid.
 *   4. (editor mode only) `useFileSourceAutoSave`-style hook collects
 *      mutations and PUT-backs through `DriveFileSource.save()`.
 *      v1 ships read + render only; the save lane is the v0.2 follow-
 *      up alongside the fullscreen route's chrome.
 */

import { useEffect, useMemo, useState } from "react";

import { CasualSheets, type CasualSheetsProps } from "@schnsrw/casual-sheets/sheets";
import { xlsxToWorkbookData } from "@schnsrw/casual-sheets/xlsx";
import "@schnsrw/casual-sheets/styles";
import type { IWorkbookData } from "@univerjs/core";

import { type FileDto } from "../../api/client.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";

export interface CasualSheetWorkspaceProps {
  /** FileDto from Drive's state — used to construct the DriveFileSource. */
  file: FileDto;
  /**
   * `preview` = no Office chrome (modal stage). `editor` = full ribbon
   * (fullscreen `/file/<id>` route). Defaults to `'preview'` so the
   * modal mount stays clean.
   */
  mode?: "preview" | "editor";
  /**
   * Fired once the parsed snapshot is mounted. The host can use this
   * to flip a "Loading workbook…" spinner off, or to drive its own
   * chrome (filename + dirty indicator) based on the live Univer API.
   */
  onReady?: CasualSheetsProps["onReady"];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: IWorkbookData }
  | { kind: "error"; message: string };

const PREVIEW_UI: CasualSheetsProps["ui"] = {
  header: false,
  toolbar: false,
  footer: false,
  contextMenu: true,
};

const EDITOR_UI: CasualSheetsProps["ui"] = {
  header: true,
  toolbar: true,
  footer: true,
  contextMenu: true,
};

export function CasualSheetWorkspace({
  file,
  mode = "preview",
  onReady,
}: CasualSheetWorkspaceProps) {
  const fileSource = useMemo(() => new DriveFileSource(file), [file.id]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { bytes } = await fileSource.open(file.id);
        // xlsxToWorkbookData spins up a Web Worker; first call has a
        // one-time chunk load (~1.5 MB) but the bundle is gated behind
        // this mount so the rest of Drive isn't paying for it.
        const data = await xlsxToWorkbookData(bytes);
        if (cancelled) return;
        setState({ kind: "ready", data });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, fileSource]);

  const ui = mode === "editor" ? EDITOR_UI : PREVIEW_UI;

  if (state.kind === "loading") {
    return (
      <div
        data-testid="sheet-workspace-loading"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        Opening {file.name}…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        data-testid="sheet-workspace-error"
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
          Couldn't open this workbook
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 420 }}>
          {state.message}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="sheet-workspace"
      data-mode={mode}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    >
      <CasualSheets initialData={state.data} ui={ui} onReady={onReady} />
    </div>
  );
}
