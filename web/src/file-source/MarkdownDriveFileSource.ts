/**
 * MarkdownDriveFileSource — opens Markdown (`.md`) documents in the docs
 * editor (`<CasualEditor>`), which is a DOCX/OOXML editor and cannot parse
 * markdown bytes directly.
 *
 * The docs SDK ships a WASM format converter for exactly this ("foreign
 * format → DOCX on open, DOCX → foreign format on export"; see the SDK's
 * `format-converter.ts`, where `md` is a `FOREIGN_FORMAT`). Its own File→Open
 * menu uses it, but Drive mounts the editor via `fileSource`/`docId`, which
 * feeds bytes straight to the DOCX parser with NO conversion. So we run the
 * conversion at the FileSource boundary instead:
 *
 *   open(id):  GET .md bytes  → convertToDocx(bytes, "md") → DOCX for the editor
 *   save(id):  DOCX from editor → exportDocxAs(docx, "md") → PUT .md text
 *
 * The file therefore stays Markdown on disk (`Content-Type: text/markdown`,
 * inherited from `DriveFileSource.save`) — the DOCX form only ever lives in the
 * editor's memory. Round-tripping through OOXML is lossy for exotic markdown,
 * but every save appends a NEW immutable version (history is append-only), so a
 * lossy conversion never destroys prior content.
 *
 * Used only for markdown; every other kind keeps the plain `DriveFileSource`.
 */

import { convertToDocx, exportDocxAs } from "@casualoffice/docs";

import { DriveFileSource } from "./DriveFileSource.ts";

export class MarkdownDriveFileSource extends DriveFileSource {
  /** GET the markdown bytes, up-convert to DOCX for the editor to parse. */
  override async open(id: string): Promise<{ bytes: ArrayBuffer; name: string; etag?: string }> {
    const raw = await super.open(id);
    const docx = await convertToDocx(new Uint8Array(raw.bytes), "md");
    // Hand the editor exactly the converter's output slice (it may be a view
    // into a larger buffer).
    const bytes = docx.buffer.slice(
      docx.byteOffset,
      docx.byteOffset + docx.byteLength,
    ) as ArrayBuffer;
    return { bytes, name: raw.name, etag: raw.etag };
  }

  /** The editor hands us DOCX bytes; convert back to markdown text and PUT
   *  that (so the `.md` file stays markdown), preserving the etag/If-Match
   *  concurrency contract of the base source. */
  override async save(
    id: string | null,
    bytes: ArrayBuffer,
    opts?: { etag?: string; name?: string },
  ): Promise<{ id: string; etag: string }> {
    const out = await exportDocxAs(new Uint8Array(bytes), "md");
    // exportDocxAs → string for `md`; tolerate a byte payload defensively.
    const markdown = typeof out === "string" ? out : new TextDecoder().decode(out);
    const mdBytes = new TextEncoder().encode(markdown);
    return super.save(id, mdBytes.buffer, opts);
  }
}
