# 03 — Settings surface

Companion to `02-surface-v2.md`. The Settings surface was explicitly deferred from `02-surface.md` §"What this doc deliberately doesn't cover"; this doc closes that gap for the v0 build.

## Pattern reference (researched, not invented)

Industry pattern across **Linear / Vercel / Stripe / Notion / Figma**: a narrow left section nav + a content pane on the right. Section nav stays sticky as the pane scrolls. Each section is a *single page* with its own title, description, and one or more cards — never a tabbed surface inside a section.

Picked because:

1. Discoverability — every setting Drive will ever have is visible at a glance in the nav.
2. Linkability — `/settings/storage` deep-links to one section; back/forward stays useful.
3. Polish ceiling — no nested tabs to fight, no modals to remember.

## Layout

```
┌─ Drive shell ────────────────────────────────────────────────────────────────┐
│ Sidebar │ Settings                                                            │
│  …      │                                                                    │
│         │ ┌─ Section nav ─────┐  ┌─ Content pane ────────────────────────┐   │
│         │ │ Account            │  │ # Account                              │  │
│         │ │ Workspace          │  │ Your sign-in and personal preferences. │  │
│         │ │ Members            │  │                                        │  │
│         │ │ Roles & perms      │  │ ┌─ Card: Change password ───────────┐  │  │
│         │ │ Sharing            │  │ │ Current password [_______]         │  │  │
│         │ │ Storage            │  │ │ New password     [_______]         │  │  │
│         │ │ Notifications      │  │ │ Confirm          [_______]         │  │  │
│         │ │ API tokens         │  │ │                       [ Save ]     │  │  │
│         │ │ Audit log          │  │ └────────────────────────────────────┘  │  │
│         │ │ About              │  │ ┌─ Card: Sessions ─────────────────┐    │  │
│         │ │                    │  │ │ Active sessions: 1                │    │  │
│         │ └────────────────────┘  │ └────────────────────────────────────┘    │  │
│         │                         └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Section nav: 240 px fixed, `--paper` background, `--line` right border, sticky to top of pane.
- Content pane: scroll body, `max-width: 760px` for readability, centered horizontally at >900 px.
- Top of content pane: title (Fraunces 28 px) + description (Hanken 14 px muted) + horizontal rule.
- Body of content pane: stacked **cards** (`--card` bg, `--line` border, 16 px radius, 24 px padding). One card per logical group, never two settings sharing a card.
- Card layout: card heading (Fraunces 18 px) + helper text + controls + `Save` aligned right.
- `Save` button: ink fill, paper text, no border. Disabled until form is dirty + valid. Shows a spinner inline while submitting; success toast on save; inline `aria-live` error on failure.

## Section inventory

| Slug | Title | v0 status | Real / stub | What the v0 build includes |
|---|---|---|---|---|
| `account` | Account | ✅ real | real | Change password (cards: Change password, Sign out other sessions) |
| `workspace` | Workspace | 🟦 stub | ComingSoon | Workspace rename / icon / default visibility — v0.2 |
| `members` | Members | 🟦 stub | ComingSoon | Invite teammates, role assignments — v0.2 |
| `roles` | Roles & permissions | 🟦 stub | ComingSoon | Custom roles + per-permission grid — v0.2 |
| `sharing` | Sharing | 🟦 stub | ComingSoon | Default expiry, default permission, link-password requirement — wires once §7 lands |
| `storage` | Storage | ✅ real | real | Backend in use (fs/S3/MinIO), bucket/region, total used, optional quota — read-only |
| `notifications` | Notifications | 🟦 stub | ComingSoon | Email-on-share, email-on-mention — v0.2 |
| `tokens` | API tokens | 🟦 stub | ComingSoon | Personal API tokens (issue / revoke) — v0.2 |
| `audit` | Audit log | 🟦 stub | ComingSoon | Link to `/activity` — wires once §10 lands |
| `about` | About | ✅ real | real | Version, git sha, build timestamp, license, backend, db |

Build order inside this surface: Account → Storage → About → all stubs.

## Forms — `react-hook-form` + `zod`

Per `02-surface-v2.md` §Stack. Every settings form:

- Validates on `blur` (not on every keystroke — too noisy in a settings context).
- Renders inline field errors below the input in `--danger` colour with 13 px Hanken.
- Disables `Save` until the form is `isDirty && isValid`.
- On submit error, focuses the first invalid field and announces the error via `aria-live="polite"`.

## State checklist per section

| | Required | Notes |
|---|---|---|
| Default (loaded) | yes | section title + one or more cards |
| Loading | yes | skeleton in card body, not in title |
| Empty (where applicable) | per-section | only ComingSoon sections — uses the `ComingSoon` component (not `EmptyState`) |
| Error | yes | `aria-live` toast + inline message above the offending card |
| Success | yes | sonner toast `"Saved."` — never an inline banner that the user has to dismiss |
| Skeleton | yes | card bodies skeleton-pulse until first byte; section nav never skeletons |

## Out of scope (v0)

- Per-section deep-linking that survives URL paste *across reloads*. The nav uses internal `setSection` state. URL deep-linking is a Phase-2 router rewrite.
- Search-in-settings. Re-evaluate once `>20` settings exist.
- Theme toggle. Lives in §2.11 of the pipeline, not in Settings, because v0 doesn't yet have dark mode tokens.

## Endpoints touched

- `POST /api/auth/change-password` — body `{old_password, new_password}`. Verifies old via Argon2id, rehashes new, **invalidates every other session for this user** (defense against stolen-cookie scenarios). Caller's session stays alive. Returns 204.
- `GET /api/about` — `{version, git_sha, built_at, license, backend, db}`. Pulled from `env!` at compile time; no DB read.
- Storage section reads `/api/me` for backend kind + `/api/storage/usage` (when present); falls back to a "—" readout when the endpoint isn't wired yet so the section still looks complete.
