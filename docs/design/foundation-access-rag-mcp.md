# Foundation Design — Access Control, Projects, System Admin, RAG, MCP

The foundation layer that everything (incl. AI) sits on. Build order is deliberate: **access control first**, then projects, then the system-admin surface, then retrieval (RAG), then MCP. AI features (summaries/Q&A) come **after** and must respect all of it.

Grounded in the current state (see the codebase map): today auth is *workspace-membership-or-owner* with only `owner|member` roles, no per-resource ACLs, no per-user sharing, no projects, Tantivy full-text but no embeddings/RAG, no MCP. `users.is_admin` exists (basis for system admin).

Principles: **deny-by-default**, least privilege, defense-in-depth (index/DB re-checks), ACL **inheritance** down the tree, every allow/deny path auditable, documents-only.

---

## 1. Identity & principals

- **User** — an account (`users`). May carry `is_admin` → **system superadmin** (instance operator), authenticated the same way but gated to the system surface (§4).
- **Workspace** — the org/tenant boundary (Personal or Team), holds the DEK.
- **Project** — an access container *inside* a workspace (§3). Folders/files live under a project (or a default project per workspace for back-compat).
- **Principal in a scope** — a `(user, scope, role)` where scope ∈ {workspace, project}. Roles resolve to permissions (§2).

## 2. RBAC model

### Roles (per scope: workspace and project)
`Owner` ⊃ `Admin` ⊃ `Editor` ⊃ `Viewer`. (Workspace `Owner` is the existing owner; `member` migrates to `Editor` by default — see migration note.)

### Permissions (capability set)
`view, download, comment, edit, create, delete(=tombstone), share, manage_members, manage_settings, manage_retention, manage_keys`.

### Role → permission matrix
| perm | Viewer | Editor | Admin | Owner |
|---|---|---|---|---|
| view / download | ✓ | ✓ | ✓ | ✓ |
| comment | ✓ | ✓ | ✓ | ✓ |
| edit / create | | ✓ | ✓ | ✓ |
| delete (tombstone) | | ✓ | ✓ | ✓ |
| share | | ✓ | ✓ | ✓ |
| manage_members / invitations | | | ✓ | ✓ |
| manage_settings / retention / keys | | | ✓ | ✓ |
| transfer / delete workspace | | | | ✓ |

Represented as a `Permission` enum + a `role_permissions(role) -> PermSet` function (bitset) in a new `dochub-authz` module (or `dochub-core::authz`). No hard-coded string comparisons in handlers.

## 3. ACLs, projects & effective-permission resolution

### Tables (new migrations)
- `projects(id, workspace_id, name, kind['team'|'personal'], created_at, …)`. A **default project** is created per existing workspace on migrate; existing folders/files backfill `project_id`.
- `project_members(project_id, user_id, role)` — project-scoped roles (optional; absence ⇒ inherit workspace role).
- `acl_grants(id, resource_kind['workspace'|'project'|'folder'|'file'], resource_id, subject_kind['user'|'role'], subject_id, role|perms, created_by, created_at)` — explicit per-resource grants, incl. **user-to-user sharing** (subject_kind='user').
- `folders`/`files` gain `project_id` (nullable during transition → default project).

### Effective permission = deny-by-default, most-specific-wins, union of grants
For `(user, resource, perm)`:
1. Walk the tree file → folder(s) → project → workspace.
2. Collect: the user's role at project (or inherited workspace role) + any `acl_grants` matching (user directly, or a role the user holds) on the resource or any ancestor.
3. Effective = union of all granted permission sets. **Superadmin bypasses** (system scope). No grant ⇒ deny.
4. **List/search** ("things I can view") is computed the same way but pushed into the query: filter candidate resources by the user's readable project set + direct file/folder grants — ACL-filter at query time, not post-hoc (index results still get a defense-in-depth re-check).

### Central enforcement
A single `authz::require(db, user, resource_ref, Permission) -> Result<(), Forbidden>` (and `authz::filter(...)` for lists). **Replace** the ad-hoc `ensure_owner` / `role_of` checks in every `dochub-http` handler with `require(...)`. Denials audited (`authz.deny`).

## 4. System admin panel ("system manager")

Instance-level, gated to **superadmin** (`users.is_admin`; harden with a dedicated `system_admins` table + bootstrap-from-env `DOCHUB_SUPERADMIN`). Separate from workspace Admin. Never touches document *plaintext* beyond existing authorized paths.

- **API** under `/api/system/*` (superadmin-only middleware, all actions audited): users (list/create/disable/reset-password/toggle-admin), workspaces (list/usage/transfer/tombstone), storage backends + usage/health, encryption keys + rotation trigger, global retention/legal-hold policies, **global audit log** (read + verify chain), instance health/metrics, **feature flags** (AI on/off, MCP on/off, provider/model), API/MCP token management.
- **UI** — a `/system` surface (neobrutalist, per `ui-system-neobrutal.md`), only rendered for superadmins: Users, Workspaces, Storage, Keys, Compliance, Audit, Health, Flags, Tokens.

## 5. Indexing + RAG (retrieval foundation)

Built so AI is grounded + **ACL-filtered**; AI features come after.
- **Extraction** — integrate `core` for `docx/xlsx/pdf` → normalized text (today only utf-8 text formats). Feeds the existing Tantivy index + chunking.
- **Chunking** — split extracted text into overlapping chunks (store `doc_chunks(file_id, seq, content_hash, text, ord)`).
- **Embeddings** — `dochub-ai` gains `embed(texts) -> Vec<Vector>` (mock in CI; provider off by default). Store vectors in `doc_embeddings` (portable: start with sqlite-vec / pgvector, or a stored-vector + in-crate cosine for small scale — pick per `research/16-scale-infra`).
- **Retrieval** — `retrieve(workspace, user, query, k)` = **ACL-filtered** union of Tantivy BM25 + vector kNN, reranked; returns chunks with `{file_id, snippet, score}`. This is the single entry point AI (summary/Q&A) and MCP use — never bypasses ACLs.
- Reindex/embed on new version; remove on tombstone; respect legal-hold per policy.

## 6. MCP tools (ACL-enforced)

An MCP server exposing Doc-Hub to LLM agents, **every tool call authenticated + ACL-checked + audited**.
- **Transport** — stdio + streamable HTTP/SSE (per MCP spec). Auth via a scoped **MCP token** (a new token kind bound to `(user_id, workspace, perms, exp)`; managed in the system panel §4).
- **Tools (read-first):** `list_documents(project?)`, `search_documents(query)` → RAG retrieve (§5), `get_document(id)` (returns text/metadata the token's user may `view`), `get_version_history(id)`, `verify_chain(id)`. Later/optional (perm-gated): `create_document`, `ask(query)` (RAG-grounded Q&A with citations).
- Each tool resolves the token → user → `authz::require`; results are ACL-filtered; no tool can exceed the token's permissions. Rate-limited.

## 7. Build sequence (each its own PR, tested, CI-green)

1. **F1 — RBAC/ACL core:** `authz` module (roles, permission matrix, `require`/`filter`), `acl_grants` + `projects`/`project_members` migrations + repos, backfill default project + `member→Editor`. Wire `require(...)` into `dochub-http` handlers (files, folders, share, workspaces, versions, compliance). Tests: role matrix, inheritance, deny-by-default, per-user share grant, list-filtering, superadmin bypass.
2. **F2 — Projects & team UX:** project CRUD + membership + invitations-with-roles enforcement; web/ project/team + roles UI (neobrutalist).
3. **F3 — System admin panel:** `/api/system/*` + superadmin gate + `system_admins`/bootstrap; `/system` UI.
4. **F4 — RAG:** `core` extraction + chunking + embeddings + `retrieve()` (ACL-filtered); wire AI summary/Q&A onto `retrieve`.
5. **F5 — MCP:** MCP server + tools over `retrieve`/`authz` + MCP tokens in the system panel.

Test contract per `docs/TESTING.md`: authz property tests (no privilege escalation, deny-by-default, tenant isolation), ACL inheritance, superadmin-bypass audited, retrieval never returns non-viewable chunks, MCP tool cannot exceed token perms. `fmt`/`clippy -Dwarnings`/`test`/`cargo deny` green.
