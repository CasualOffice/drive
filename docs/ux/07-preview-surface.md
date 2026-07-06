# 07 — Document preview surface

Companion to `02-surface-v2.md`. Covers the **read-only document preview** (used in the document-detail modal and on the recipient share page) and the **documents-only ingest allowlist**.

Doc-Hub previews **documents only**. There is no image, video, or audio preview — those types never enter the hub. The preview set is exactly: `docx`, `xlsx`, `csv`, `pdf`, `md`, `txt`, `json`, `yaml` (plus opaque `xlsm`/`pptx`, which preview only as a document glyph + Download). Editing happens in the embedded native editors ([`08-editor-handoff.md`](./08-editor-handoff.md)); this surface is the *look, don't edit* path.

## Pattern reference

**GitHub / Dropbox / Google Drive** render document previews with the minimum machinery: browser-native PDF for `.pdf`, a rendered read-only view for Office formats, and a monospaced or lightly-formatted view for text/markdown/data. We pick a narrow, documents-only set because:

1. Every supported type uses a **single, auditable primitive** — no per-type media viewer libraries.
2. Cross-origin signed URLs work transparently for `<iframe>` and text fetches — fits the two-origin model.
3. The document text we already extract with `core` (for search) doubles as the source for lightweight previews.

## Supported types

| Kind | Renderer | Source |
|---|---|---|
| `pdf` | `<iframe>` (browser's built-in PDF viewer), on the user-content origin CSP | signed download URL |
| `text` (txt / log) | `<pre>` with size cap | text fetch via download URL |
| `csv` | parsed into a read-only table (headers + rows, capped) | text fetch via download URL |
| `json` / `yaml` | pretty-printed, read-only `<pre>` (no eval, no code execution) | text fetch via download URL |
| `md` | rendered with `marked` + `DOMPurify`-sanitised HTML | text fetch via download URL |
| `docx` | read-only rendered view from `core` extraction (paginated prose) + **"Open in Casual Docs"** primary | text/layout via `core`; editing is handoff |
| `xlsx` | read-only sheet grid from `core` extraction (first sheet, capped rows/cols) + **"Open in Casual Sheet"** primary | via `core`; editing is handoff |
| `xlsm` / `pptx` (opaque) | document glyph only, **Download** primary | n/a |
| `fold` | folder glyph (no preview) | n/a |

Caps: text/`<pre>` fetches up to **512 KB** (beyond that, render the first 512 KB with a *Download for the rest* banner). Markdown caps at **256 KB** (sanitisation cost scales with input). `.csv`/`.xlsx` grids cap at **2,000 rows × 50 cols** in preview; the full document opens in Casual Sheet.

**No media renderers exist.** There is no `<img>`, `<video>`, or `<audio>` path — those extensions never pass ingest (below), so they can never reach a preview.

## Stage states

| | Required | Notes |
|---|---|---|
| Loading | yes | skeleton + "Loading preview…" — replaces the stage area, not the modal |
| Default | yes | the rendered read-only document |
| Failed-to-load | yes | falls back to the document glyph + "Couldn't load — try downloading" |
| Too-large | yes | stops at the cap, renders the truncated payload with a callout |
| Handoff | yes | docx/xlsx show the read-only view with the embedded-editor primary action |
| Opaque | yes | glyph only; primary action is Download |

The version being previewed is labelled (`v4`) so a viewer knows which point in the chain they see. From the recipient page, this is always the head at access time; from the history panel, it's the selected version.

## Ingest — allowlist first (the actual product rule)

Two layers of defense. The **allowlist is the gate**; the blocklist and byte-sniff are complementary hardening. Client-side checks are for UX (immediate toast); the **server-side check is authoritative** and runs on every path (proxy and direct-to-storage).

### Allowlist (authoritative — `CLAUDE.md` scope)

```
docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml
```

Anything not on this list is **rejected**, not quarantined. No video, no images-as-primary, no archives, no arbitrary binaries. The narrow scope is what lets Doc-Hub encrypt, index, and version everything.

Notes:

- `.xlsm` / `.pptx` are allowed but **opaque** — they never auto-open in an editor and preview only as a glyph + Download.
- The check is on the **last** dotted extension of the filename — `report.tar.gz` → `gz` (rejected, not a document), `budget.xlsx.exe` → `exe` (rejected).
- **Magic-byte sniffing** runs alongside: even an allowlisted extension is rejected if the bytes disagree (a `.pdf` that's actually a PE/ELF/Mach-O/zip-bomb is refused). The sniffed MIME overrides the client-asserted `content_type`, so the stored row is trustworthy.

### Blocklist (belt-and-suspenders)

Executable and script extensions are additionally, explicitly refused before the allowlist even applies, so an obviously-bad name fails fast:

```
exe, com, scr, bat, cmd, msi, msp, ps1, psm1, vbs, vbe, wsf, wsh, jse,
reg, lnk, scf, sh, bash, zsh, fish, csh, ksh, command,
app, dmg, pkg, jar, class, dll, so, dylib, url, desktop
```

### Server response

`POST /api/files` (or `/api/projects/{id}/files`) with a non-document type returns **415 Unsupported Media Type** with `{"error":"file type not allowed","extension":"mp4"}`. The SPA shows a toast: *"Only documents can go in the hub — `.mp4` isn't supported."* For blocklisted executables: *"`.exe` files can't be uploaded for security reasons."*

## Security notes

- Previews render on the **app origin** but fetch bytes via `/api/files/{id}/download` (or `/api/share/{token}/download`) → 302 → **user-content origin**. Cookies don't follow the cross-origin redirect; the short-TTL signed URL is the auth.
- Bytes are decrypted server-side and streamed over TLS; no plaintext document ever lands on disk. Preview never writes a decrypted temp file.
- Markdown sanitisation: `DOMPurify` default profile plus a deny-list of `iframe / object / embed / form`. External links get `rel="noopener noreferrer" target="_blank"`.
- JSON/YAML/CSV are shown as data, never parsed into executable code. Text view never `eval`s anything.
- PDF renders inside the **user-content origin's CSP** (`sandbox; default-src 'none'`), so a malicious PDF can't talk back to Doc-Hub.
- `docx`/`xlsx` read-only rendering uses `core` extraction, not an in-browser Office runtime — the same extraction feeds the search index.

## Out of scope (v0)

- Inline editing from the preview — that's the embedded-editor handoff (`08-editor-handoff.md`); preview is read-only.
- Rich diff inside preview — the version-history panel owns diff (`02-surface.md` §9).
- Syntax highlighting for `json`/`yaml`/`csv` source — v0.2 polish (no untrusted-content parser runs in v0).
- Any image / video / audio / 3D preview — permanently out of scope; the hub is documents-only.
