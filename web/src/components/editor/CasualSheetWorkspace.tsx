/**
 * CasualSheetWorkspace — Phase-1 placeholder.
 *
 * `<CasualSheets>` from `@schnsrw/casual-sheets/sheets` takes
 * `IWorkbookData` (Univer's snapshot shape), not xlsx bytes. The
 * xlsx → IWorkbookData converter that apps/web ships against in the
 * Casual Sheets repo isn't exposed by the SDK yet — adding it as a
 * `@schnsrw/casual-sheets/xlsx` subpath is the planned Phase 1.5
 * follow-up.
 *
 * Until that lands, the Preview modal renders this placeholder for
 * `kind === 'sheet'`. The "Open in editor" affordance falls back to
 * the existing WOPI new-tab handoff (`08-editor-handoff.md` pipeline
 * row 4.3) which works against `.xlsx` today.
 */

import { ExternalLink } from "lucide-react";

import { openInEditor, type FileDto } from "../../api/client.ts";

export interface CasualSheetWorkspaceProps {
  file: FileDto;
}

export function CasualSheetWorkspace({ file }: CasualSheetWorkspaceProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        Inline sheet editing — coming in v0.2
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380 }}>
        Drive's SDK wrapper for Casual Sheets ships in Phase 1.5 once the SDK
        exposes an xlsx → Univer snapshot converter. For now, use the WOPI
        handoff — opens the sheet in a new tab and saves back to this Drive.
      </div>
      <button
        type="button"
        onClick={() => {
          void (async () => {
            const resp = await openInEditor(file.id);
            window.open(resp.entry_url, "_blank", "noopener,noreferrer");
          })();
        }}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          background: "var(--accent)",
          color: "var(--accent-fg)",
          border: "none",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <ExternalLink size={14} />
        Open in Casual Sheets
      </button>
    </div>
  );
}
