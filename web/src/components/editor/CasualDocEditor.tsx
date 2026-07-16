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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CasualEditor, type CollabState, type FeatureMap } from "@casualoffice/docs";
import "@casualoffice/docs/styles.css";

import { type CollabRoom, type FileDto } from "../../api/client.ts";
import { resolveAppearance, subscribeAppearance } from "../../lib/appearance.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import { MarkdownDriveFileSource } from "../../file-source/MarkdownDriveFileSource.ts";
import {
  DISABLED_SESSION,
  presenceSession,
  type CollabPeer,
  type CollabSession,
} from "../../lib/collab.ts";
import { withSaveStatus, type OnSaveStatus } from "./save-status.ts";

/** Markdown documents mount in the docs editor too, but their bytes are
 *  markdown — not the DOCX the SDK parses — so they load through
 *  `MarkdownDriveFileSource`, which converts `.md`↔`.docx` at the byte
 *  boundary. Keyed off the stored MIME (authoritative; the backend stamps
 *  `text/markdown`) with an extension fallback. */
function isMarkdownFile(file: FileDto): boolean {
  return file.content_type === "text/markdown" || /\.(md|markdown)$/i.test(file.name);
}

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
   *  track-change authorship AND collab presence (`collab.user`). */
  user?: { name: string; color: string };
  /** P3 — a live co-editing room grant (`{ ws_url, room, token }`) minted by
   *  `GET /api/files/{id}/collab`. When present (and `mode="editor"`) the SDK
   *  opens its own Yjs provider — real CRDT sync + cursors + presence. `null`
   *  (collab disabled / declined) ⇒ single-user editing, unchanged. Preview
   *  mode is always single-user / read-only, so the grant is ignored there. */
  collab?: CollabRoom | null;
  /** Fires with the SDK's live collab presence (peers + connection status),
   *  mapped to a `CollabSession` for the shared `<CollabPresence>` header.
   *  Called with `DISABLED_SESSION` when collab is off or on unmount. */
  onPresence?: (session: CollabSession) => void;
}

export function CasualDocEditor({
  file,
  mode = "preview",
  onSaveStatus,
  onError,
  user,
  collab,
  onPresence,
}: CasualDocEditorProps) {
  // Latch the callback so the wrapped source isn't recreated on every
  // host render (the host can swap the function freely).
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;

  const fileSource = useMemo(() => {
    // Markdown loads through the converting source (`.md`↔`.docx` at the byte
    // boundary); every other kind (docx) uses the raw byte source.
    const fs = isMarkdownFile(file) ? new MarkdownDriveFileSource(file) : new DriveFileSource(file);
    // Patch save() so every save transition runs through the status
    // tracker. `bind` so the method keeps its `this` context inside
    // the source (it touches `this.file`).
    const originalSave = fs.save.bind(fs);
    fs.save = withSaveStatus(originalSave, (s) => onSaveStatusRef.current?.(s));
    return fs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const isEditor = mode === "editor";

  // P3 — declarative collab config for the SDK. Only in the editable surface,
  // and only when Drive brokered a room grant. `collab.room` is the file id
  // (Drive's per-file room); `collab.token` is the HMAC JWT the collab server's
  // onAuthenticate hook validates (wired in @casualoffice/docs 1.3.0). With
  // this set the SDK runs Yjs sync itself and seeds content from the (server-
  // seeded) room rather than the fileSource loader.
  const collabConfig = useMemo(() => {
    if (!isEditor || !collab) return undefined;
    return {
      server: collab.ws_url,
      room: file.id,
      token: collab.token,
      user: user ? { name: user.name, color: user.color } : undefined,
    };
  }, [isEditor, collab, file.id, user]);

  // Mirror Drive's resolved light/dark onto the editor. The docs SDK triggers
  // dark purely on `[data-theme="dark"]` matching an ancestor — it does NOT
  // honour `prefers-color-scheme`. Drive's ThemeToggle only writes `data-theme`
  // on <html> for explicit light/dark; in "system" mode it removes the
  // attribute and lets the OS drive tokens.css's @media block. So we resolve
  // Drive's effective appearance (attribute OR OS preference) and stamp it on
  // THIS wrapper: `[data-theme="dark"] .ep-root` then matches, dark applies to
  // the editor even in system+OS-dark, and the SDK's dark tokens stay scoped to
  // this subtree rather than needing the global <html> attribute.
  const [appearance, setAppearance] = useState(resolveAppearance);
  useEffect(() => subscribeAppearance(setAppearance), []);

  // Latch the presence sink so the mapped callback identity is stable.
  const onPresenceRef = useRef(onPresence);
  onPresenceRef.current = onPresence;

  // Map the SDK's CollabState (peers + status) onto the header's CollabSession
  // shape. No transport handles to hand back — the SDK owns the provider — so
  // doc/provider/awareness are null; the header only reads status + peers.
  const handleCollabState = useCallback((state: CollabState) => {
    const peers: CollabPeer[] = state.peers.map((p) => ({
      clientId: p.clientId,
      userId: String(p.clientId),
      name: p.name,
      tint: p.color,
      activity: "editing",
      self: p.isLocal,
    }));
    onPresenceRef.current?.(presenceSession(state.status, peers));
  }, []);

  // Reset the header indicator when collab goes away / the editor unmounts.
  useEffect(() => {
    if (collabConfig) return;
    onPresenceRef.current?.(DISABLED_SESSION);
    return () => onPresenceRef.current?.(DISABLED_SESSION);
  }, [collabConfig]);

  return (
    <div
      data-testid="casual-doc-editor"
      // Scope the SDK's dark tokens to the editor subtree (see the appearance
      // effect above). Matches `[data-theme="dark"] .ep-root` without touching
      // the global <html> attribute Drive's chrome reads.
      data-theme={appearance}
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
        // editable surface; the preview mount stays read-only. Kept on under
        // collab too: this is the client-push snapshot path (main CLAUDE.md
        // M2), coordinated with Yjs by the SDK (externalContent).
        autosave={isEditor}
        author={user?.name}
        user={user}
        // P3 — real CRDT co-editing. `collab` wins over the deprecated
        // `user`/`backendUrl` pair for awareness; undefined ⇒ single-user.
        collab={collabConfig}
        onCollabState={collabConfig ? handleCollabState : undefined}
        onError={onError}
        // Native-feel (doc 39, Phase 0 host-only): with onSave set, the SDK's
        // Cmd+S / File▸Save persist through Drive instead of downloading a .docx
        // (DocxEditor only blob-downloads when onSave is unset). fileSource.save
        // is already wrapped with withSaveStatus, so this also drives the pill.
        onSave={
          isEditor ? (buffer) => void fileSource.save(file.id, buffer) : undefined
        }
        docxEditorProps={{
          // Native-feel (doc 39, Phase 4): chrome:"embedded" renders the
          // formatting toolbar ONLY — no TitleBar/MenuBar/logo/About, and Cmd+O/N
          // are suppressed — so the editor is a bare editing surface inside
          // Drive's own shell (one shell, not two). Supersedes the Phase-0
          // renderLogo/onRequestOpen host workarounds. Preview stays chromeless.
          chrome: isEditor ? "embedded" : "none",
          // Fill the flex parent so the editor owns the available viewport.
          style: { flex: 1, minHeight: 0 },
        }}
      />
    </div>
  );
}
