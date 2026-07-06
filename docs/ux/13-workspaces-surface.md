# 13 — Projects, personal locker + ownership

Companion to `02-surface.md` + `03-settings-surface.md`. Doc-Hub organises documents into a **personal locker** (one per user, DigiLocker-style) plus zero-or-more **team projects**. This surface covers the model, the sidebar switcher, the Settings → Project card, roles, invitations, and ownership transfer.

> Underlying tables are the inherited `workspaces` (+ `workspace_members`, `workspace_invitations`, `workspace_storage`); the product terms are **personal locker** and **project**. Each is an encryption boundary: every project/locker has its own per-workspace **DEK**, wrapped by the master KEK, so documents in one project are sealed under a different key than another. `files.workspace_id` + `folders.workspace_id` scope every list/search/upload/create path; membership is enforced via `WorkspaceMemberRepo::role_of`; cross-project isolation is covered by `documents_are_workspace_scoped` in `crates/dochub-db/tests/repos.rs`.

## Tiers

1. **Personal locker** — auto-created on user creation, 1-to-1 with the user, can never be renamed away from "Personal", deleted, or transferred. The default after sign-in. This is the private, self-hosted document locker for one person's papers.
2. **Team project** — created explicitly. Exactly one **Owner**, plus **Admins**, **Editors**, and **Viewers**. Members join by invitation.

## Roles

| Role | Read documents | Edit / commit versions | Manage members + settings | Retention / legal hold | Delete project |
|---|---|---|---|---|---|
| **Owner** | yes | yes | yes | yes | yes |
| **Admin** | yes | yes | yes (invite, remove, roles) | yes | no |
| **Editor** | yes | yes | no | no | no |
| **Viewer** | yes (+ version history, provenance verify) | no | no | no | no |

- A Viewer can read a document, browse its version history, and **verify** its provenance, but cannot commit a new version, restore, tombstone, or share.
- Compliance actions (place/release a legal hold, edit retention) are Owner/Admin only and always audited.
- Roles gate actions; the append-only history and encryption invariants hold regardless of role (no role can hard-delete a version).

## Backend contract

### `GET /api/projects` (authed)

```json
{
  "current_id": "wsp_personal_admin",
  "projects": [
    { "id": "wsp_personal_admin", "name": "Personal", "kind": "personal",
      "owner_id": "usr_admin", "role": "owner", "member_count": 1, "created_at": "…" },
    { "id": "wsp_eng", "name": "Engineering", "kind": "team",
      "owner_id": "usr_admin", "role": "owner", "member_count": 4, "created_at": "…" }
  ]
}
```

- Returns every project the caller is a member of plus a `current_id` hint (server returns the personal-locker id; the SPA persists the chosen project in `localStorage` and overrides).
- `role` is the caller's role in that project: `owner | admin | editor | viewer`.

### `POST /api/projects` (authed)

```json
{ "name": "Engineering" }
```

→ **201** with the created project. Caller is auto-inserted as Owner. Name 2–60 chars, trimmed. Always `kind: "team"`. A fresh per-project DEK is generated and wrapped by the master KEK at creation; boot-time invariants guarantee a KEK exists, so this never produces an unwrapped key.

### Invitations

| Method | Path | Effect |
|---|---|---|
| `POST` | `/api/projects/{id}/invitations` | Owner/Admin. Body `{ email, role }`. Creates a `workspace_invitations` row + emails a **magic link** (single-use, expiring token). Audited `project.invite`. |
| `GET` | `/api/invitations/{token}` | Public. Resolves an invite to `{ project_name, role, inviter }` for the accept screen. |
| `POST` | `/api/invitations/{token}/accept` | Authed. Adds the caller as a member at the invited role; consumes the token. Audited `project.member_join`. |
| `DELETE` | `/api/projects/{id}/members/{user_id}` | Owner/Admin (Admins can't remove Owners). Audited `project.member_remove`. |
| `PATCH` | `/api/projects/{id}/members/{user_id}` | Owner/Admin. Changes a member's role. Audited `project.role_change`. |

Invitations reuse the inherited magic-link mechanism (single-use token, Argon2id-hashed at rest, expiry).

### `POST /api/projects/{id}/transfer` (authed, owner-only)

```json
{ "new_owner_id": "usr_alice" }
```

- **204** — atomic transaction: old Owner → Admin, new Owner → Owner. Audit-emit `project.transfer_owner` with both ids.
- **403** caller isn't Owner · **404** project missing · **422** target isn't a member · **409** refused on the personal locker.

### `/api/me` adds

```json
{ "...": "...", "personal_locker_id": "wsp_personal_admin" }
```

## Sidebar switcher

```
┌─ Sidebar switcher ────────────────────────────┐
│  [P] Personal               ▾                 │
└───────────────────────────────────────────────┘
            ↓ click
┌─ Projects ────────────────────────────────────┐
│  PERSONAL                                      │
│  [P] Personal               · Owner            │
│  TEAM                                          │
│  [E] Engineering            · Owner            │
│  [M] Marketing              · Editor           │
│  ──────────                                    │
│  ＋ Create project                              │
└───────────────────────────────────────────────┘
```

- Trigger: the sidebar pill.
- Selection persists in `localStorage` as `dochub-current-project-v1`; bootstrap falls back to `personal_locker_id` from `/api/me`.
- Switching re-scopes Documents, search, and uploads in the same render via `ProjectContext`.
- "+ Create project" opens a small name dialog; on success the new project becomes current.

## Settings → Project card

Replaces the placeholder under Settings → Project. For the current project:

- Header: name, kind pill, member count.
- **Rename** (Owner/Admin). Inline edit, Save / Cancel.
- **Members** (Owner/Admin) — list with role badges; invite by email + role; change role; remove. Viewers/Editors see the roster read-only.
- **Transfer ownership** (Owner, team projects only) — picker of other members.
- **Leave project** (non-Owner members on team projects).
- **Delete project** (Owner, team projects only) — confirms with the project name. Deleting a project **does not** hard-delete documents: their versions and blobs are tombstoned under retention/legal-hold rules (nothing under an active hold can be removed), and the project's DEK is retained until the last blob is purged so the history stays verifiable. History is never erased by deleting a project.

## Audit events added

| Action | Actor | Target |
|---|---|---|
| `project.create` | user | project |
| `project.rename` | user | project |
| `project.invite` | user | project (metadata: email, role) |
| `project.member_join` | user | project |
| `project.member_remove` | user | project (metadata: removed_user_id) |
| `project.role_change` | user | project (metadata: user_id, from, to) |
| `project.transfer_owner` | user | project (metadata: from_user_id, to_user_id) |
| `project.delete` | user | project |

## Scope endpoints

| Endpoint | How the project is chosen |
|---|---|
| `GET /api/folders/root/children` | `?project=<id>`, defaults to caller's personal locker |
| `GET /api/search?q=…` | `?project=<id>`, defaults to personal locker |
| `POST /api/folders` | `project_id` body field |
| `POST /api/documents` | `project_id` multipart field |
| `GET /api/folders/{id}` | derived from the folder row; membership of `folder.workspace_id` enforced |

A caller-supplied id is rejected **403** if the caller isn't a member. Writes additionally require an edit-capable role (Editor+); Viewers get **403** on any mutating path.

## Out of scope (later)

- Per-project storage quotas separate from per-user caps.
- Nested sub-projects / project hierarchies.
- Sharing documents **across** projects (share-links stay the cross-project primitive; a cross-project move needs version-chain re-scoping + re-keying under the target DEK).
- Cross-IdP federated membership.
