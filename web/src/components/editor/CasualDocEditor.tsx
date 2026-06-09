/**
 * CasualDocEditor — Drive's React wrapper around `<CasualEditor>` from
 * `@schnsrw/docx-js-editor`. Mounts in the Preview modal's stage when
 * the focused file's kind is `'doc'` (per `FileThumb.tsx`'s
 * `inferKind`).
 *
 * What the wrapper owns vs delegates:
 *   - Constructs a fresh `DriveFileSource` for the file id; the SDK
 *     uses it to fetch + persist bytes through Drive's content
 *     endpoints (`GET / PUT /api/files/{id}/content`).
 *   - Threads the signed-in admin's display name + a per-user colour
 *     into `<CasualEditor user={...}>` so collab awareness has a label
 *     when collab is on.
 *   - Reads `VITE_DRIVE_COLLAB_BACKEND_URL` at build time. When set,
 *     enables Yjs collab; when unset (the Phase-1 default), the
 *     editor runs standalone and Drive ships as one container.
 *   - Turns on `autosave` so user edits push back through
 *     `DriveFileSource.save` on a tick — the same behaviour the
 *     standalone Casual Docs surface ships.
 *
 * What the wrapper does NOT own:
 *   - File metadata refresh — `DriveFileSource.currentFile()` carries
 *     the latest FileDto after each save; Drive's workspace context
 *     refetches the file list when needed.
 *   - Lock lifecycle — Drive doesn't run a third-party WOPI host
 *     against itself; lock is implicit (single tenant, single user).
 *   - Signing UI — Phase 2 lands a separate `<SigningProvider>` mount
 *     around this wrapper.
 */

import { useMemo } from "react";

import { CasualEditor, type UseFileSourceAutoSaveReturn } from "@schnsrw/docx-js-editor";

import type { FileDto } from "../../api/client.ts";
import { useAuth } from "../../auth/AuthContext.tsx";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";

/** Stable per-user palette swatch. Same hash → same colour across
 *  sessions so peers don't see the lead author's marker hop on every
 *  reload. */
const COLOURS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#475569",
];
function colourFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return COLOURS[Math.abs(hash) % COLOURS.length] ?? COLOURS[0]!;
}

export interface CasualDocEditorProps {
  /** FileDto from Drive's state — used by DriveFileSource to provide
   *  the file name + version etag to the editor without an extra
   *  metadata round trip. */
  file: FileDto;
  /** Optional autosave-state subscriber. PreviewModal uses this to
   *  render a "Saving… / Saved 2 min ago" indicator in its top
   *  chrome alongside the file title. */
  onAutosaveState?: (state: UseFileSourceAutoSaveReturn) => void;
}

const COLLAB_BACKEND_URL = (import.meta.env.VITE_DRIVE_COLLAB_BACKEND_URL ?? "") as string;

export function CasualDocEditor({ file, onAutosaveState }: CasualDocEditorProps) {
  const auth = useAuth();
  const fileSource = useMemo(() => new DriveFileSource(file), [file.id]);
  const user = useMemo(() => {
    const username =
      auth.status.kind === "authed" ? auth.status.me.admin : "anonymous";
    return { name: username, color: colourFor(username) };
  }, [auth.status]);

  const backendUrl = COLLAB_BACKEND_URL || undefined;

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <CasualEditor
        fileSource={fileSource}
        docId={file.id}
        backendUrl={backendUrl}
        user={user}
        autosave
        onAutosaveState={onAutosaveState}
      />
    </div>
  );
}
