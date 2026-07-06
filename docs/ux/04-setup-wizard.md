# 04 — First-run admin + master-key setup wizard

Companion to `02-surface-v2.md` + `03-settings-surface.md`. Closes the install gap: a freshly-deployed Doc-Hub with zero users shouldn't show a sign-in card the operator has no credentials for — and it must make the encryption posture explicit before anyone stores a document.

## When it triggers

- App boot calls `GET /api/setup/status` *before* `/api/me`.
- If the response is `{needs_setup: true}` (zero users in DB), render the wizard.
- On a successful `POST /api/setup/admin`, the backend mints a session for the new admin in the same response — the SPA goes straight from wizard to shell, never via the sign-in card.
- `needs_setup` is a one-way switch: once one user exists it stays `false` forever. Re-runs are a fresh install, not a recovery flow.

## Precondition: the server already has a key

Encryption is not optional and is not configured in the browser. The binary **refuses to start** without `DOCHUB_MASTER_KEY` or a configured KMS (boot invariant). So by the time this wizard renders, a master key is *already present* — the wizard's job is to **confirm and explain** it, not to collect it. There is no keyless path a browser could reach.

## Layout

```
┌─ Setup wizard (centered card, max-width 460px) ──────────────────────┐
│                                                                       │
│                       [Shield logo · 56px]                            │
│                                                                       │
│                   Welcome to Doc-Hub                             │
│         An encrypted, tamper-evident home for your documents.         │
│                                                                       │
│   Step ●——○——○——○                                                    │
│   1 / 4                                                               │
│                                                                       │
│   ┌─ Step body ───────────────────────────────────────────────────┐  │
│   │  (per-step content — paragraph + form fields + CTA)           │  │
│   └───────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

Four steps:

1. **Welcome** — one paragraph: Doc-Hub is an encrypted, tamper-evident document registry; history is permanent, documents are encrypted at rest, editing is native, everything is findable by content. A **Get started** button. No form.
2. **Encryption** — a read-only confirmation card. Shows the master-key **source** (`master key (env)` or `AWS KMS (arn:…)`), a `shield-check` glyph, algorithm **AES-256-GCM envelope encryption**, and the plain-language line: **"Documents are encrypted at rest. Keep this master key safe — without it, encrypted documents can't be recovered."** Plus the honest trade: **"The server holds keys so it can search and reason over your documents. This is not zero-knowledge E2E."** A single **Continue** button. The key is never displayed or entered here.
3. **Create admin** — username + password + confirm. Inline validation: username ≥ 3, password ≥ 12, confirm matches. Submit → `POST /api/setup/admin` → on success the cookie is set and CSRF is stashed.
4. **Ready** — "Welcome, *username*. Opening your hub…" + a 600 ms beat → routes into the shell. An acknowledgement state; never gates the user.

## Component / token reuse

- Card uses the SignIn surface tokens (`--card` bg, `--line` border, `--radius-xl`, `--shadow`).
- Title in Fraunces 24 px / 500. Helper Hanken 14 px / `--muted`.
- Step indicator: 4 dots, active `--ink`, completed `--accent`, pending `--line-strong`. 8 px each, 6 px gap, animated advance.
- Inputs reuse the SignIn `<Input>` style.
- Primary button: full-width, `--ink` fill, `--paper` text, 12 px radius.
- Encryption step reuses the Settings **Encryption & keys** card visual (read-only variant).

## State checklist per step

| | Welcome | Encryption | Create admin | Ready |
|---|---|---|---|---|
| Default | copy + CTA | read-only key card + Continue | empty form, primary disabled | spinner → toast → redirect |
| Loading | n/a | brief key-source fetch | submit spinner inline | n/a |
| Error | n/a | key-source unreadable → "Encryption is active, details unavailable." (still Continue) | aria-live band above form | n/a (errors return to Create admin) |
| Success | n/a | Continue advances | clear form, advance | redirect after 600 ms |

## Backend contract

### `GET /api/setup/status` (public)

```json
{ "needs_setup": true, "encryption": { "source": "kms", "algorithm": "AES-256-GCM" } }
```

- 200 only, no auth. Safe before sign-in.
- Returns `needs_setup: false` once at least one row exists in `users`.
- `encryption.source` is `"env"` or `"kms"`; **no key bytes** are ever returned. The field exists only to populate the read-only Encryption step.

### `POST /api/setup/admin` (public, gated by zero-users invariant)

Body:

```json
{ "username": "…", "password": "…" }
```

Responses:

- **204** + `Set-Cookie: __Host-dh_sid=…` and `{csrf_token: "…"}` — admin created, session minted.
- **409** if a user already exists (post-race or replay).
- **422** if username < 3 or password < 12.

Race protection: count + insert in a transaction; `UNIQUE(username)` backs it up.

## Security notes

- Wizard endpoints mount **on the app origin only** — never on user-content. Host-dispatch middleware enforces this.
- Wizard endpoints **bypass CSRF** (no session yet); the zero-users invariant is the only access control. Once a user exists, both endpoints are 409 permanently.
- The password is Argon2id-hashed via the same `dochub_auth::hash_password` used by regular sign-in — no separate path.
- `GET /api/setup/status` returns encryption *source* only; it must never leak key material, KMS credentials, or the KEK.

## Out of scope

- Collecting or rotating the master key in the UI — key management is env/KMS; rotation lives in Settings → Encryption & keys, admin-only.
- Storage backend picker — configured via env vars, not the UI (security-sensitive).
- OIDC bootstrap — Phase 3 (gates the wizard behind a "use SSO" option).
- First team-project creation — the admin lands in their Personal locker and creates projects from the shell (flow 4).
