# 05 — Sharing surface

Companion to `02-surface-v2.md` + `03-settings-surface.md` + `04-setup-wizard.md`. Covers the **owner-side share modal** and the **recipient page** that the link opens to.

## Pattern reference

Across **Dropbox / Google Drive / Notion**, the share UX collapses three concerns into one modal:

1. *Who* can access (everyone with the link / specific people — v0 ships only the link option).
2. *What* they can do (View / Edit — v0 ships View; Edit deferred until Casual Sheets / Editor agree on collaborative semantics).
3. *How long* and *gated by what* (expiry + optional password).

The modal closes with a single primary action: **Copy link**. There's no separate "Save" step — saving happens implicitly on the first option change so the user can copy the link immediately.

Recipient page: stripped chrome, file card front-and-center, one primary action (Open in editor / Download). Password gate becomes a single full-screen form when present.

## Modal layout

```
┌─ Share modal (Radix Dialog, 460×auto, ink-glass overlay) ─────────────┐
│                                              [×]                       │
│   ┌─ Header ────────────────────────────────────────────────────┐     │
│   │  [thumb]  Q2 planning.xlsx                                  │     │
│   │           Share this file                                   │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                       │
│   ┌─ Link card (active) ────────────────────────────────────────┐    │
│   │   🔗  Anyone with the link  · View                          │    │
│   │       https://drive.../s/Z3kQ…aB1                            │    │
│   │       [ ⊕ Copy link ]                          [ ⋯ Options ]│    │
│   └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│   ┌─ Options (collapsible) ─────────────────────────────────────┐    │
│   │   Permission   [ View ▼ ]   (Edit — v0.2)                   │    │
│   │   Expires      ( ◯ Never  ◉ In 7 days  ◯ 30 days  ◯ Date ) │    │
│   │   Password     [ ………… ]   (optional)                        │    │
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

- Radix Dialog overlay uses `--bg-overlay` + 6 px blur (same as PreviewModal).
- Link card uses `--accent-muted` background + 1 px `--accent` border so the active link reads at a glance.
- Options panel is initially collapsed; clicking ⋯ reveals it.
- Existing-links list is hidden when there are zero shares for the file.
- Copy button shows an inline check + "Copied" for 1.4 s, then reverts. No toast — the inline confirmation is enough.

## Recipient page layout

URL: `https://drive.<host>/s/<token>` — served by the SPA's `spa::serve` fallback, then the SPA recognises the path and renders `<Recipient>` instead of the shell.

```
┌─ Recipient (no sidebar, no top bar) ─────────────────────────────────┐
│                                                                       │
│      [Casual Drive · cloud mark, 36 px]                               │
│                                                                       │
│      ┌─ File card (centered, 540 px max) ──────────────────────┐    │
│      │                                                           │    │
│      │   [Big thumbnail 320 × 200]                              │    │
│      │                                                           │    │
│      │   Q2 planning.xlsx                                       │    │
│      │   Spreadsheet · 28.4 KB · shared by owner               │    │
│      │                                                           │    │
│      │   ──────────────                                         │    │
│      │                                                           │    │
│      │   [ Open in Casual Sheets ]   [ Download ]               │    │
│      │                                                           │    │
│      └───────────────────────────────────────────────────────────┘    │
│                                                                       │
│      Powered by Casual Drive                                          │
└───────────────────────────────────────────────────────────────────────┘
```

Password gate (when set):

```
┌─ Recipient (password) ───────────────────────────────────────────────┐
│                                                                       │
│      [Casual Drive cloud mark]                                        │
│                                                                       │
│      Enter the password to access this file.                          │
│      [ ……… ]                                                          │
│      [ Continue ]                                                     │
│                                                                       │
│      (Wrong password? — inline aria-live)                             │
└───────────────────────────────────────────────────────────────────────┘
```

Expired:

```
┌─ Recipient (expired) ────────────────────────────────────────────────┐
│      This share link has expired.                                     │
│      The file's owner can issue a new one.                            │
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
  "url": "https://drive.<host>/s/Z3kQ…aB1",
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

Body:

```json
{ "password": null }
```

Responses:

- **200** + `{file: {name, size, content_type, ...}, download_url: "/api/share/{token}/download"}` — the recipient can fetch bytes via the download_url (which itself just 302s to a signed `/raw/{token}` on the user-content origin).
- **401** if a password is required and either missing or wrong. The 401 carries `WWW-Authenticate: x-share-password` so the SPA knows to prompt.
- **410** if the link is expired.
- **404** if the link doesn't exist or the underlying file has been trashed.

### `GET /api/share/{token}/download` (public)

302 → signed download URL on the user-content origin, with the same password gate. Increments `access_count` and updates `last_accessed_at` on each successful redirect.

## Security notes

- Token is **128 random bits** → URL-safe base64 (22 chars). Compared in constant time against the DB row.
- Password (when set) is Argon2id-hashed at the same parameters as user passwords (OWASP minimum). Compared in constant time via the existing `drive_auth::verify_password`.
- Even for *anyone-with-link* shares, every recipient request issues a fresh signed URL with a short TTL (60 s default) — so the link itself is not equivalent to the file bytes.
- `POST /api/share/{token}` is a **POST**, not a GET, so password material never sits in browser history / referer / proxy logs.
- Rate limit + audit emit live in the same middleware band as `/api/auth/sign-in`.
- The recipient page lives on the **app origin** (cookies are scoped there); file bytes are served from the **user-content origin** via the signed URL. No cookies are needed for the byte fetch.

## State checklist

**Modal**

| | Required | Notes |
|---|---|---|
| Default (no existing link) | yes | Link card shows a placeholder URL + Copy button is *Generate link* |
| Default (existing link) | yes | Link card shows the latest link + Copy button |
| Options open | yes | Reveals expiry, permission, password |
| Saving | yes | Inline spinner on Save; button disabled |
| Error | yes | aria-live band above the card |
| Copy success | yes | Inline check on the Copy button, 1.4 s revert — no toast |

**Recipient**

| | Required | Notes |
|---|---|---|
| Default | yes | File card + primary action |
| Password gate | yes | Single full-screen form, focus-on-mount |
| Wrong password | yes | aria-live below input, no shake |
| Expired | yes | Static message, no action |
| Not found | yes | Same static message — never disambiguate from expired (anti-enumeration) |
| Downloading | yes | Inline spinner replaces the button label for the duration |

## Out of scope (v0)

- "Specific people" sharing — needs multi-user, v0.2.
- Edit permission — needs WOPI handoff sign-in for the recipient, v0.2 paired with the editor lock-coordination work.
- Folder sharing — share_links schema supports it, but the recipient page's "render a folder tree" lives in v0.2.
- Notify-on-access webhook — Phase-3 audit work.
