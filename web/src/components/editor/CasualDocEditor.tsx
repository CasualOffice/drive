/**
 * CasualDocEditor — Drive's mount for `.docx` files. Renders the in-app
 * React `<CasualEditor>` from `@casualoffice/docs` DIRECTLY into Drive's
 * tree (no iframe seam). Phase 1 of the native-SDK integration.
 *
 * Why the direct mount (replacing the old `<CasualEditorIframe>`):
 *   - No iframe seam. The editor shares Drive's viewport, scroll, focus,
 *     and design surface, so `.docx` editing feels fully native inside
 *     Drive's own fullscreen chrome (titlebar / back / share / presence
 *     all live in `<FileFullscreen>`, not in a nested frame).
 *   - Single React runtime. The docs SDK is a ProseMirror editor (no
 *     Univer `LocaleService`); the wrapper sets up its own `LocaleProvider`
 *     internally, so mounting alongside Drive's React tree is safe. (React
 *     is a deduped peer dep — one instance shared with the SDK.)
 *
 * Chrome (native feel, via the `features` flag-map + `chrome` preset):
 *   - `mode="editor"`  → `documentMode="editing"`, full editor chrome MINUS
 *     the bottom status bar (Drive's header owns save/version status, so the
 *     bar would be redundant — matches Google Docs, which has no persistent
 *     bottom bar). The formatting toolbar, zoom, print, and the right-edge
 *     panel rail (Outline / Comments) stay — Drive doesn't provide those.
 *   - `mode="preview"` → `documentMode="viewing"` (read-only) + `chrome="none"`
 *     + every control hidden: JUST the rendered document canvas for the
 *     Preview modal / read-only fullscreen viewer.
 *
 * Persistence (host owns storage; SDK never does): the wrapper loads bytes
 * via `DriveFileSource.open(docId)` on mount and — with `autosave` enabled
 * in editor mode — writes back through `DriveFileSource.save(...)`
 * (`PUT /api/files/{id}/content`, cookie + CSRF, version-as-etag). We wrap
 * `save()` in `withSaveStatus` so every round-trip drives the "Saving… /
 * Saved / Failed" pill in `<FileFullscreen>`.
 *
 * NOTE: with P2 mounting Sheets natively too, both editors are now iframe-free.
 * `scripts/copy-embed.mjs`, the `public/embed/` tree, and the prebuild step that
 * populated it were all retired — nothing serves an embed runtime anymore.
 */

import { useMemo, useRef } from "react";

import { CasualEditor, type FeatureMap } from "@casualoffice/docs";
import "@casualoffice/docs/styles.css";

import { type FileDto } from "../../api/client.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import { withSaveStatus, type OnSaveStatus } from "./save-status.ts";

/** Editor mode: hide only the bottom status bar — Drive's fullscreen
 *  header already surfaces save state + version, so the SDK's bar is
 *  redundant. Everything else (formatting toolbar, zoom, print, panel
 *  rail) is the editing UI the user needs and Drive doesn't provide. */
const EDITOR_FEATURES: FeatureMap = { statusBar: false };

/** Preview mode: read-only viewer — hide ALL chrome so the modal /
 *  read-only viewer paints just the document canvas. */
const PREVIEW_FEATURES: FeatureMap = {
  toolbar: false,
  panelRail: false,
  statusBar: false,
  zoomControl: false,
  printButton: false,
  outline: false,
  ruler: false,
};

export interface CasualDocEditorProps {
  file: FileDto;
  /** `preview` = read-only, no chrome, just canvas (modal / viewer mount).
   *  `editor` = editing with the SDK's toolbar + panel rail (fullscreen). */
  mode?: "preview" | "editor";
  /** Optional callback that fires on every save attempt. Drives the
   *  "Saving… / Saved / Failed" pill in `<FileFullscreen>`. */
  onSaveStatus?: OnSaveStatus;
  /** Fires when the editor surfaces a parse / load / boot failure.
   *  Drive's PreviewStage swaps the editor for a friendly fallback card
   *  so users never see the SDK's raw error UI. */
  onError?: (error: Error) => void;
  /** Drive's signed-in user — threaded to the editor for comment /
   *  track-change authorship (and, in a later phase, collab presence). */
  user?: { name: string; color: string };
}

export function CasualDocEditor({
  file,
  mode = "preview",
  onSaveStatus,
  onError,
  user,
}: CasualDocEditorProps) {
  // Latch the callback so the wrapped source isn't recreated on every
  // host render (the host can swap the function freely).
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;

  const fileSource = useMemo(() => {
    const fs = new DriveFileSource(file);
    // Patch save() so every save transition runs through the status
    // tracker. `bind` so the method keeps its `this` context inside
    // DriveFileSource (it touches `this.file`).
    const originalSave = fs.save.bind(fs);
    fs.save = withSaveStatus(originalSave, (s) => onSaveStatusRef.current?.(s));
    return fs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const isEditor = mode === "editor";

  return (
    <div
      data-testid="casual-doc-editor"
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CasualEditor
        fileSource={fileSource}
        docId={file.id}
        documentMode={isEditor ? "editing" : "viewing"}
        features={isEditor ? EDITOR_FEATURES : PREVIEW_FEATURES}
        // Persist edits through DriveFileSource on a tick — only in the
        // editable surface; the preview mount stays read-only.
        autosave={isEditor}
        author={user?.name}
        user={user}
        onError={onError}
        docxEditorProps={{
          // Bare canvas for the read-only preview; the full shell for the
          // editing surface (individual controls tuned via `features`).
          chrome: isEditor ? "full" : "none",
          // Fill the flex parent so the editor owns the available viewport.
          style: { flex: 1, minHeight: 0 },
        }}
      />
    </div>
  );
}
