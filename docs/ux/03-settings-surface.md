# 03 — Settings surface

Companion to `02-surface-v2.md`. The Settings surface for Doc-Hub: account, project/team admin, encryption + key management, retention + legal hold, storage, audit, and about.

## Pattern reference (researched, not invented)

Industry pattern across **Linear / Vercel / Stripe / Notion / Figma**: a narrow left section nav + a content pane on the right. Section nav stays sticky as the pane scrolls. Each section is a *single page* with its own title, description, and one or more cards — never a tabbed surface inside a section.

Picked because:

1. Discoverability — every setting is visible at a glance in the nav.
2. Linkability — `/settings/encryption` deep-links to one section; back/forward stays useful.
3. Polish ceiling — no nested tabs, no modals to remember.

## Layout

```
┌─ Doc-Hub shell ─────────────────────────────────────────────────────────────────┐
│ Sidebar │ Settings                                                            │
│  …      │                                                                    │
│         │ ┌─ Section nav ─────┐  ┌─ Content pane ────────────────────────┐   │
│         │ │ Account            │  │ # Encryption & keys                    │  │
│         │ │ Project            │  │ How this hub protects documents at   │  │
│         │ │ Members            │  │ rest.                                  │  │
│         │ │ Roles & perms      │  │ ┌─ Card: Master key ─────────────────┐ │  │
│         │ │ Sharing            │  │ │ Source: AWS KMS (arn:…)   ✔ active │ │  │
│         │ │ Encryption & keys  │  │ │ Algorithm: AES-256-GCM envelope    │ │  │
│         │ │ Retention & holds  │  │ │           [ Rotate master key ]    │ │  │
│         │ │ Storage            │  │ └────────────────────────────────────┘ │  │
│         │ │ Audit log          │  │ ┌─ Card: Workspace data keys ───────┐  │  │
│         │ │ About              │  │ │ 3 workspaces · all wrapped        │  │  │
│         │ │                    │  │ └────────────────────────────────────┘ │  │
│         │ └────────────────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Section nav: 240 px fixed, `--paper` background, `--line` right border, sticky.
- Content pane: scroll body, `max-width: 760px`, centered at >900 px.
- Top of pane: title (Fraunces 28 px) + description (Hanken 14 px muted) + rule.
- Body: stacked **cards** (`--card` bg, `--line` border, 16 px radius, 24 px padding). One card per logical group.
- Card: heading (Fraunces 18 px) + helper + controls + `Save` right-aligned.
- `Save`: ink fill, paper text, disabled until dirty + valid, inline spinner on submit, success toast, inline `aria-live` error on failure.

## Section inventory

| Slug | Title | v0 status | What v0 includes |
|---|---|---|---|
| `account` | Account | ✅ real | Change password; sign out other sessions |
| `project` | Project | ✅ real | Rename active project, description, default document visibility; delete team project (Personal locker is not deletable) |
| `members` | Members | 🟦 partial | Invite via magic link, role assignment (Owner/Admin/Member), atomic ownership transfer |
| `roles` | Roles & permissions | 🟦 stub | Per-permission grid — Phase 4 |
| `sharing` | Sharing | ✅ real | Default expiry, default permission (View), require-password default |
| `encryption` | Encryption & keys | ✅ real | Master-key source (env/KMS), algorithm, **Rotate master key** (re-wraps DEKs, no blob rewrite), workspace DEK status — **read-only key material, never displayed** |
| `retention` | Retention & holds | ✅ real | Retention policies (duration before a tombstone is purge-eligible), legal holds (list, place, release) |
| `storage` | Storage | ✅ real | Backend in use (fs/S3/MinIO/R2/B2), bucket/region, total used, optional quota — read-only |
| `audit` | Audit log | ✅ real | Link to `/activity`; **Export report** (verifiable JSONL); chain-verified status |
| `about` | About | ✅ real | Version, git sha, build timestamp, license, backend, db |

Build order: Account → Encryption & keys → Retention & holds → Storage → Audit → About → Project/Members → Roles stub.

## Encryption & keys — detail

The section states the hub's protection posture; it never exposes key bytes.

- **Master key card:** source (`master key (env)` or `AWS KMS (arn:…)`), status **✔ active** (always — boot refuses to start without a key), algorithm **AES-256-GCM envelope**. **Rotate master key** re-wraps every workspace DEK under a new KEK **without rewriting document blobs**; a confirm explains that documents stay readable throughout. Rotation is audited.
- **Workspace data keys card:** count of workspaces, all shown as **wrapped** (never plaintext). No export, no reveal.
- Copy makes the trade explicit: **"Encryption defends a stolen disk or database — not a compromised server. The server holds keys so it can index and reason over your documents. This is deliberate, and is not zero-knowledge E2E."**

## Retention & holds — detail

- **Retention policies card:** set the window a tombstoned document must age before it becomes purge-eligible (e.g. 30 / 90 / 365 days / never). Applies per project. Saving is audited.
- **Legal holds card:** list active holds; **Place hold** (on a document or a whole project) and **Release hold** (admin-only, audited). A held document cannot be tombstoned or purged by any path. Release is the one destructive-styled action here and shows a confirm: **"Release the hold on *NDA.pdf*? It becomes subject to retention again."**

## Forms — `react-hook-form` + `zod`

Every settings form:

- Validates on `blur`.
- Renders inline field errors below the input in `--danger`, 13 px Hanken.
- Disables `Save` until `isDirty && isValid`.
- On submit error, focuses the first invalid field and announces via `aria-live="polite"`.

## State checklist per section

| | Required | Notes |
|---|---|---|
| Default (loaded) | yes | section title + one or more cards |
| Loading | yes | skeleton in card body, not in title |
| Empty | per-section | stub sections use the `ComingSoon` component |
| Error | yes | `aria-live` + inline message above the offending card |
| Success | yes | sonner toast `"Saved."` |
| Confirm (destructive) | yes | rotate key / delete project / release hold — inline confirm, not a silent action |

## Out of scope (v0)

- Custom roles + per-permission grid — Phase 4.
- Registrar / issuer-key management (provenance signing keys) — Phase 4, extends Encryption & keys.
- Search-in-settings — re-evaluate past 20 settings.
- Theme toggle — lives in the avatar menu, not Settings.

## Endpoints touched

- `POST /api/auth/change-password` — `{old_password, new_password}`. Verifies old via Argon2id, rehashes, **invalidates every other session** for this user; caller's session stays alive. 204.
- `POST /api/keys/rotate-master` (admin) — re-wraps all workspace DEKs under a new KEK; no blob rewrite; audited. Returns 202 + a job id; on completion every document still decrypts (property-tested).
- `GET /api/retention` / `PUT /api/retention` (admin) — read/write retention policy per project.
- `POST /api/holds` / `DELETE /api/holds/{id}` (admin) — place / release a legal hold; both audited.
- `GET /api/audit/export?before=…&after=…` (admin) — verifiable JSONL export of the append-only, hash-chained `audit_log`.
- `GET /api/about` — `{version, git_sha, built_at, license, backend, db}` from `env!` at compile time; no DB read.
- Storage section reads `/api/me` (backend kind) + `/api/storage/usage`; falls back to "—" when unwired.

> Naming: the auth crate and env prefix are the target `dochub_auth` / `DOCHUB_*`; docs may still show `drive_*` / `DRIVE_*` in flight (PLAN.md Phase 0).
