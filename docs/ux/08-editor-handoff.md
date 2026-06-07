# 08 — Editor handoff (WOPI)

Companion to `docs/ARCHITECTURE.md` §"Three-token identity model" + `docs/research/01-wopi.md`. Defines the **`GET /api/files/{id}/open`** endpoint that lights up the "Open in Casual Sheets / Editor" buttons.

## Flow

```
SPA (drive.<host>)              Drive backend                   Casual Sheets (sheet.<host>)
─────────────────               ─────────────                   ─────────────────────────────
click "Open in Casual Sheets"
      │
      ▼
GET /api/files/{id}/open ─────► verify file exists + owner
                                mint WOPI access token
                                pick editor by content-type
                                build entry_url
                          ◄──── 200 {editor_app, entry_url,
                                     access_token,
                                     access_token_ttl}
window.open(entry_url, "_blank")
                          ────────────────────────────────► load editor
                                                             editor calls back via WOPI:
                                                             /wopi/files/{id}
                                                             /wopi/files/{id}/contents
                                                             /wopi/files/{id} (lock/unlock)
```

The token Drive mints is the *same* WOPI token the editor will hand back on every call — minted with `drive_wopi::mint_token` over `(user_id, file_id, perms, exp, jti)`. TTL = 10 min, in line with the WOPI spec; the editor refreshes its own clock via `CheckFileInfo`.

## Endpoint contract

### `GET /api/files/{id}/open` (authed, owner-only)

```json
{
  "editor_app": "sheet",                          // "sheet" | "document"
  "entry_url": "https://sheet.example.org/wopi/editor?WOPISrc=https%3A%2F%2Fdrive.example.org%2Fwopi%2Ffiles%2Ff_xyz&access_token=<jwt>",
  "access_token": "<jwt>",
  "access_token_ttl": 600000,                     // ms; matches CLAUDE.md "10 min"
  "wopi_src": "https://drive.example.org/wopi/files/f_xyz"
}
```

- **401** if no session.
- **403** if the caller isn't the file owner.
- **404** if the file is missing or trashed.
- **415** if the file's extension isn't mapped to an editor (only `.xlsx` / `.docx` in v0; macro-enabled cousins are explicitly unsupported per CLAUDE.md).

Editor-app dispatch table:

| Extension | content_type (sniffed) | editor_app | Origin env var |
|---|---|---|---|
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `sheet` | `DRIVE_SHEET_ORIGIN` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `document` | `DRIVE_DOCUMENT_ORIGIN` |
| anything else | — | (415) | — |

The editor's launch path under its own origin is `/wopi/editor`. That's a sibling-repo concern (`../sheet/`, `../document/`); Drive only knows the origin.

## SPA behaviour

1. From the Preview Modal's primary action (or the row's context-menu "Open"), call `openInEditor(file.id)`.
2. Before the network call: `window.open("about:blank", "_blank")` to grab a popup handle synchronously — browsers only allow popups inside a click handler, so we can't open one after an `await`.
3. When the response lands, set the popup's location to `entry_url`. If the popup handle is null (blocked), show a sonner toast with a "Click to open" button that does the same redirect on a real click.
4. Audit-emit `files.open_in_editor` on the server, with `{editor_app}` in metadata so the Activity feed renders "opened *Q2.xlsx* in Casual Sheets."

## Config additions

```
DRIVE_SHEET_ORIGIN     = https://sheet.<host>
DRIVE_DOCUMENT_ORIGIN  = https://document.<host>
```

Optional in v0 — when missing, `/api/files/{id}/open` returns `503 Service Unavailable` with `{"error": "editor not configured"}` and the SPA shows a polished "editor isn't configured on this instance" toast. The Open buttons stay visible but become advisory.

## Demo mode

The Pages demo has no live editor sibling, so `openInEditor` returns synthesised 503 metadata and the SPA shows: *"Casual Sheets / Editor isn't included in the static demo — self-host the real build to use it."* + a Download fallback. This keeps the buttons working as a discoverable feature instead of silently failing.

## Security recap

- Token is bound to the user, the file id, the perms, and a `jti`. Validated on every WOPI request via `verify_token`, which also enforces the URL `file_id` matches the claim.
- The handoff endpoint is **app-origin only** (cookies live there). The editor talks to `/wopi/files/{id}` on the app origin too — also covered by `host_dispatch`.
- The mint is **owner-only** today. When sharing-with-edit-permission lands (v0.2), share-link consumers get their own per-share scoped token at `/s/{token}/open`.
- `/api/files/{id}/open` is a `GET` because it's idempotent; nothing changes on the file itself. Token uniqueness comes from the `jti` claim per launch.

## Out of scope (v0)

- Edit handoff from share-link recipients — needs RBAC + a recipient-side session model. v0.2.
- PowerPoint / Casual Slides — the sibling editor doesn't exist yet (CLAUDE.md §"Out of scope"). Slot reserved with a `pptx` MIME mapping returning 501.
- Co-editing presence at the Drive level — editor owns its own collaboration; Drive is files.
