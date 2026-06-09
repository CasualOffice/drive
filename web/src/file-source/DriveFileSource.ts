/**
 * DriveFileSource — implements the editor SDK's `FileSource` interface
 * against Drive's `GET / PUT /api/files/{id}/content` endpoints.
 *
 * Phase 1 of the SDK integration plan
 * (`docs/ux/10-sdk-integration-plan.md`). Lets Drive's React tree mount
 * `<CasualEditor>` / `<CasualSheets>` and have them transparently load +
 * save bytes through the same authenticated session the SPA already
 * holds (cookie + CSRF) — no token mint, no user-content origin redirect.
 *
 * One source instance per open document. Construct with the FileDto the
 * SPA already has from its file-list state so the editor can show a
 * name in its title bar without a second round trip just to fetch
 * metadata.
 *
 * What this source does NOT do (and the editor never asks of it given
 * the wrapper's mount shape):
 *   - `list / rename / delete / watchRecent / rememberLastOpened /
 *     lastOpened`: Drive owns those surfaces in its own chrome
 *     (Sidebar, EntryMenu, recent-files in WorkspaceContext). The
 *     no-ops keep the FileSource contract satisfied without
 *     duplicating logic the SPA already does.
 *   - new-file save (`id: null`): Drive's new-file UI is the Sidebar
 *     "Upload" action; the editor never mounts against a null id
 *     because the wrapper requires a fileId prop. Throws if hit.
 */

import type { FileSource, FileEntry } from "@schnsrw/docx-js-editor";

import { ApiError, getCsrfToken, type FileDto } from "../api/client.ts";

const NO_OP_UNSUBSCRIBE = () => {};

/**
 * The editor wraps `save()`'s return type around `{ id, etag }`. Drive's
 * FileDto carries `version: number` which we surface as the etag string
 * — every save bumps it, the editor uses it for optimistic-write
 * protection on the next save.
 */
export class DriveFileSource implements FileSource {
  readonly kind = "personal" as const;
  readonly label = "Casual Drive";

  /** Mirrors the FileDto the SPA had at construction; refreshed on save. */
  private file: FileDto;

  constructor(file: FileDto) {
    this.file = file;
  }

  /** Re-read the current file metadata snapshot. Hosts use this to sync
   *  Drive's sidebar after a save (size + modifiedAt bump). */
  currentFile(): FileDto {
    return this.file;
  }

  async open(id: string): Promise<{ bytes: ArrayBuffer; name: string; etag?: string }> {
    if (id !== this.file.id) {
      // The wrapper enforces a 1:1 file-id binding; this branch only
      // hits if a host wires the source incorrectly. Throw early so
      // it's loud rather than silently fetching the wrong file.
      throw new Error(
        `DriveFileSource: open('${id}') doesn't match constructor file id '${this.file.id}'`,
      );
    }
    const res = await fetch(`/api/files/${encodeURIComponent(id)}/content`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => null);
      throw new ApiError(res.status, body, `GET /api/files/${id}/content failed`);
    }
    const bytes = await res.arrayBuffer();
    return {
      bytes,
      name: this.file.name,
      etag: String(this.file.version),
    };
  }

  async save(
    id: string | null,
    bytes: ArrayBuffer,
    _opts?: { etag?: string; name?: string },
  ): Promise<{ id: string; etag: string }> {
    if (id === null) {
      throw new Error(
        "DriveFileSource: new-file save (id=null) isn't supported — Drive's Sidebar Upload owns that flow.",
      );
    }
    if (id !== this.file.id) {
      throw new Error(
        `DriveFileSource: save('${id}') doesn't match constructor file id '${this.file.id}'`,
      );
    }
    const csrf = getCsrfToken();
    const res = await fetch(`/api/files/${encodeURIComponent(id)}/content`, {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": this.file.content_type ?? "application/octet-stream",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: bytes,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => null);
      throw new ApiError(res.status, body, `PUT /api/files/${id}/content failed`);
    }
    const updated = (await res.json()) as FileDto;
    this.file = updated;
    return { id: updated.id, etag: String(updated.version) };
  }

  // ─── no-ops (Drive owns these surfaces in its own chrome) ────────────

  async list(): Promise<FileEntry[]> {
    return [];
  }

  async rename(_id: string, _newName: string): Promise<void> {
    // Drive's RenameDialog hits PATCH /api/files/{id} directly. The
    // editor never invokes this when its parent (Drive) handles
    // rename in its own UI; the FileSource contract still requires
    // a callable method.
  }

  async delete(_id: string): Promise<void> {
    // Drive's trash flow hits POST /api/files/{id}/trash directly.
    // Same story as rename — no-op.
  }

  watchRecent(_cb: (recent: FileEntry[]) => void): () => void {
    // Drive's WorkspaceContext owns recent-files. The editor's
    // built-in recent-files list isn't rendered in the Preview-modal
    // mount, so no subscriptions ever land here.
    return NO_OP_UNSUBSCRIBE;
  }

  async rememberLastOpened(_id: string | null): Promise<void> {
    // Drive's Home page tracks last-opened via WorkspaceContext.
  }

  async lastOpened(): Promise<string | null> {
    return null;
  }
}
