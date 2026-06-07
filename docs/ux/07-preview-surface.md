# 07 — Preview surface

Companion to `02-surface-v2.md`. Covers the Preview Modal's per-type stage and the upload-side extension blocklist.

## Pattern reference

**Dropbox / Google Drive / GitHub** render previews inline using the browser's native capabilities wherever possible: `<img>` for raster + SVG, `<iframe>` (or `<embed>`) for PDF (browser-native PDF.js), `<video>` and `<audio>` for media, and a syntax-aware monospaced view for source / text / markdown. Office docs hand off to a dedicated editor.

We pick the same set because:

1. Every supported type uses **a single web platform primitive**. Zero per-type viewer libraries to maintain.
2. Cross-origin signed URLs work transparently for `<img>`, `<video>`, `<audio>`, `<iframe>` — fits our two-origin model.
3. Office handoff via WOPI is already in the build order; previewing them inline would duplicate effort.

## Supported types

| Kind | Renderer | Source URL |
|---|---|---|
| `img` (png / jpg / gif / webp / svg / avif / heic) | `<img>` | signed download URL |
| `pdf` | `<iframe>` (browser's built-in PDF viewer) | signed download URL |
| `vid` (mp4 / webm / mov) | `<video controls>` | signed download URL |
| `aud` (mp3 / wav / ogg / flac / m4a) | `<audio controls>` | signed download URL |
| `text` (txt / log / csv / json / yaml / toml / ini / source-code files) | `<pre>` with size cap | text fetch via download URL |
| `md` | rendered with `marked` + `DOMPurify`-sanitised HTML | text fetch via download URL |
| `doc` (.docx) | procedural doc thumbnail + "Open in Casual Editor" primary | n/a — handoff |
| `sheet` (.xlsx) | procedural sheet thumbnail + "Open in Casual Sheets" primary | n/a — handoff |
| `fold` | folder glyph (preview not really meaningful) | n/a |
| `generic` | the generic procedural thumbnail | n/a — download primary |

Text-mode cap: fetch up to **512 KB**. Beyond that, render only the first 512 KB with a *Show more in a download* banner. Markdown caps at 256 KB for the same reason (sanitisation cost scales with input).

## Stage states

| | Required | Notes |
|---|---|---|
| Loading | yes | spinner + "Loading preview…" — replaces the stage area, not the modal |
| Default | yes | the rendered preview |
| Failed-to-load | yes | falls back to the procedural thumbnail + helper "Couldn't load — try downloading" |
| Too-large | yes | stops loading at the cap, renders the truncated payload with a callout |
| Unsupported | yes | renders the thumbnail; primary action stays as Download |

## Upload restrictions

Two layers of defense. Client-side check is for UX (toast immediately, save a round-trip). Server-side check is the **actual gate**.

### Blocklist

The following file extensions are refused at upload time:

```
Scripts / executables:
  exe, com, scr, bat, cmd, msi, msp,
  ps1, psm1, vbs, vbe, wsf, wsh, jse,
  reg, lnk, scf,
  sh, bash, zsh, fish, csh, ksh, command,
  app, dmg, pkg,
  jar, class, dll, so, dylib,
  url, desktop
```

Notes:

- Office macro-enabled formats (`.docm`, `.xlsm`, `.pptm`) are **allowed** per `CLAUDE.md` — they're opaque blobs from Drive's perspective and never auto-open in the editor.
- The check is purely on the **last** dotted extension of the supplied filename — `setup.tar.gz` → `gz` (allowed), `setup.tar.gz.exe` → `exe` (blocked).
- Magic-byte sniffing (pipeline §6.2) is the complementary second layer. Both run on every upload — the extension blocklist catches obviously-bad names; the byte sniffer rejects PE / Mach-O / ELF / Java / wasm / COFF payloads regardless of filename, and overrides the client-asserted `content_type` with the sniffed MIME so callers can trust what the row says.

### Server response

`POST /api/files` with a forbidden extension returns **415 Unsupported Media Type** with `{"error": "file type not allowed", "extension": "exe"}`. SPA shows a toast: *"`.exe` files can't be uploaded for security reasons."*

## Security notes

- Previews render on the **app origin**, but fetch bytes via the `/api/files/{id}/download` 302 → user-content origin. Cookies don't follow the redirect (`credentials: "same-origin"` + cross-origin redirect = stripped); the signed URL is the auth.
- Markdown sanitisation: `DOMPurify` with the default profile, plus our own deny-list of `iframe / object / embed / form` (no Drive markdown should ever inject one of those). External links in rendered markdown get `rel="noopener noreferrer"` and `target="_blank"` so a clicked link doesn't navigate the modal away.
- Text view never `eval`s anything. Code highlighting is a Phase-2 polish — we do not run a syntax-highlighting parser over untrusted content in v0.
- PDF in `<iframe>` runs inside the **user-content origin's CSP** (`sandbox; default-src 'none'`), so even a malicious PDF can't talk back to Drive.

## Out of scope (v0)

- Office inline preview (Phase 2 — paired with the read-only WOPI viewer mode).
- Image zoom + pan, video chapters, audio waveform — these are nice; not v0.
- Syntax highlighting for source files — v0.2.
- 3D / CAD viewers — v1.x at earliest.
