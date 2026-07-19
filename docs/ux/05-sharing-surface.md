# 05 — Sharing surface

Companion to `02-surface-v2.md` + `03-settings-surface.md` + `04-setup-wizard.md`. Covers the **owner-side share modal** and the **recipient page** the link opens to. Sharing in Doc-Hub is per-document, view-first, and served on the isolated **user-content origin** — never the app origin.

## Pattern reference

Across **Dropbox / Google Drive / Notion**, the share UX collapses three concerns into one modal:

1. *Who* can access (anyone with the link / specific people — v0 ships only the link option).
2. *What* they can do (View / Edit — v0 ships **View**; Edit deferred until the embedded editors agree on recipient-scoped collaborative semantics).
3. *How long* and *gated by what* (expiry + optional password).

The modal closes with a single primary action: **Copy link**. No separate "Save" — saving happens implicitly on the first option change so the user can copy immediately.

Recipient page: stripped chrome, document card front-and-center, one primary action (Open read-only / Download). Password gate is a single form when present. **Documents only — no media preview.**

## Modal layout

```
┌─ Share modal (Radix Dialog, 460×auto, ink-glass overlay) ─────────────┐
│                                              [×]                       │
│   ┌─ Header ────────────────────────────────────────────────────┐     │
│   │  📄  Q2 planning.xlsx   · v7                                │     │
│   │      Share this document                                    │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│   ┌─ Link card (active) ────────────────────────────────────────┐    │
│   │   🔗  Anyone with the link  · View                          │    │
│   │       https://usercontent-doc-hub.…/s/Z3kQ…aB1                │    │
│   │       [ ⊕ Copy link ]                          [ ⋯ Options ]│    │
│   └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│   ┌─ Options (collapsible) ─────────────────────────────────────┐    │
│   │   Permission   [ View ▼ ]   (Edit — v0.2)                   │    │
│   │   Expires      ( ◯ Never  ◉ In 7 days  ◯ 30 days  ◯ Date ) │    │
│   │   Password     [ ………… ]   (optional, Argon2id)              │    │
│   │                                            [ Save changes ] │    │
│   └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│   ┌─ Existing links (when ≥1) ──────────────────────────────────┐    │
│   │   Z3kQ…aB1   · View · expires in 6 d  ·  Copy   Revoke      │    │
│   │   M9pX…Lz4   · View · password · 12 opens  ·  Copy  Revoke  │    │
│   └─────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

Notes:

- Header shows the document's current **version** (`v7`) so the owner knows what a "view" recipient sees (the head at access time).
- Radix Dialog overlay uses `--bg-overlay` + 6 px blur (same as the document detail modal).
- Link card uses `--accent-muted` background + 1 px `--accent` border so the active link reads at a glance.
- Options panel is initially collapsed; clicking ⋯ reveals it.
- Existing-links list is hidden when there are zero shares.
- Copy shows an inline check + "Copied" for 1.4 s, then reverts. No toast.
- Creating, editing, or revoking a link never touches the document or its history — it's link metadata only. Every share action appends an audit event (`share.create` / `share.revoke`).

## Recipient page layout

The recipient page renders on the **app origin** (via the SPA fallback), but document bytes are fetched from the **user-content origin** through a short-TTL signed URL.

```
┌─ Recipient (no sidebar, no top bar) ─────────────────────────────────┐
│                                                                       │
│      [Doc-Hub · shield mark, 36 px]                             │
│                                                                       │
│      ┌─ Document card (centered, 540 px max) ──────────────────┐    │
│      │                                                           │    │
│      │   📄  (document type glyph, no thumbnail)                │    │
│      │                                                           │    │
│      │   Q2 planning.xlsx                                       │    │
│      │   Spreadsheet · 28.4 KB · shared by owner               │    │
│      │                                                           │    │
│      │   ──────────────                                         │    │
│      │                                                           │    │
│      │   [ Open read-only ]        [ Download ]                 │    │
│      │                                                           │    │
│      └───────────────────────────────────────────────────────────┘    │
│                                                                       │
│      Powered by Doc-Hub                                          │
└───────────────────────────────────────────────────────────────────────┘
```

- **Open read-only** renders the document preview per [`07-preview-surface.md`](./07-preview-surface.md) — docx/xlsx/pdf/md/txt/csv/json/yaml only, no media. Edit-share (v0.2) would launch the embedded editor with a recipient-scoped token.
- No procedural thumbnail, no big content render on the card — a document type glyph.

Password gate (when set):

```
┌─ Recipient (password) ───────────────────────────────────────────────┐
│      [Doc-Hub shield mark]                                       │
│      Enter the password to access this document.                      │
│      [ ……… ]                                                          │
│      [ Continue ]                                                     │
│      (Wrong password? — inline aria-live)                             │
└───────────────────────────────────────────────────────────────────────┘
```

Expired / revoked / not-found (single message — anti-enumeration):

```
┌─ Recipient (inactive) ───────────────────────────────────────────────┐
│      This link is no longer active.                                   │
│      The document's owner can issue a new one.                        │
└───────────────────────────────────────────────────────────────────────┘
```

## Backend contract

### `POST /api/files/{id}/share` (authed, owner-only)

Body:

```json
{
  "permissions": "view",          // "view" only in v0; "edit" reserved
  "password": null,               // string or null
  "expires_in_seconds": 604800    // i64 or null (null = never)
}
```

Response (201):

```json
{
  "id": "shl_…",
  "token": "Z3kQ…aB1",            // 16 random bytes → URL-safe base64
  "url": "https://usercontent-doc-hub.<host>/s/Z3kQ…aB1",
  "permissions": "view",
  "has_password": false,
  "expires_at": "2026-06-13T22:00:00Z",
  "created_at": "2026-06-06T22:00:00Z"
}
```

### `GET /api/files/{id}/shares` (authed, owner-only)

```json
{ "shares": [ { ...same shape, plus access_count, last_accessed_at... } ] }
```

### `DELETE /api/shares/{share_id}` (authed, owner-only) → 204

### `POST /api/share/{token}` (public)

Body: `{ "password": null }`

Responses:

- **200** + `{document: {name, size, content_type, version, ...}, download_url: "/api/share/{token}/download"}` — the recipient fetches bytes via `download_url`, which 302s to a signed `/raw/{token}` on the **user-content origin**.
- **401** if a password is required and missing/wrong. Carries `WWW-Authenticate: x-share-password` so the SPA prompts.
- **410** if expired.
- **404** if the link doesn't exist or the underlying document is tombstoned.

### `GET /api/share/{token}/download` (public)

302 → signed download URL on the user-content origin, same password gate. Increments `access_count`, updates `last_accessed_at`, and appends `share.access` (anonymous actor) to the audit log on each successful redirect.

## Security notes

- Token is **128 random bits** → URL-safe base64 (22 chars). Compared in constant time against the DB row.
- Password (when set) is Argon2id-hashed at the same parameters as user passwords, verified in constant time via `dochub_auth::verify_password`.
- Every recipient request mints a fresh signed URL with a short TTL (60 s default) — the link is not equivalent to the bytes.
- Document bytes are decrypted server-side and streamed only over the **user-content origin** (`CSP: sandbox; default-src 'none'`, no cookies, `Content-Disposition: attachment` for non-previewable types). No plaintext ever lands on disk.
- `POST /api/share/{token}` is a POST so password material never sits in history / referer / proxy logs.
- Rate limit + audit emit live in the same middleware band as `/api/auth/sign-in`.
- The app origin never serves `/raw/{token}`; the two-origin split is non-negotiable.

## State checklist

**Modal**

| | Required | Notes |
|---|---|---|
| Default (no existing link) | yes | Link card Copy button reads *Generate link* |
| Default (existing link) | yes | Link card shows the latest link + Copy |
| Options open | yes | Reveals expiry, permission, password |
| Saving | yes | Inline spinner on Save; button disabled |
| Error | yes | aria-live band above the card |
| Copy success | yes | Inline check on Copy, 1.4 s revert — no toast |

**Recipient**

| | Required | Notes |
|---|---|---|
| Default | yes | Document card + primary action |
| Password gate | yes | Single form, focus-on-mount |
| Wrong password | yes | aria-live below input, no shake |
| Inactive (expired/revoked/not-found) | yes | Single static message — never disambiguate (anti-enumeration) |
| Downloading | yes | Inline spinner replaces the button label |

## Out of scope (v0)

- "Specific people" sharing — needs multi-user, v0.2.
- Edit permission — needs recipient-scoped editor tokens, v0.2 paired with editor lock-coordination.
- Folder / project sharing — the schema supports it; the recipient tree view is v0.2.
- Notify-on-access webhook — Phase 4 audit work.
