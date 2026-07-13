# 01 — Core UX Flows

The interaction-level spec for Doc-Hub. No pixel mockups — that's [`02-surface.md`](./02-surface.md) (next). This doc answers *what happens*, *in what order*, *what does the user see and feel*, *what's the keyboard*, *what's the copy*.

Calibration: the polish bar is the macOS-app reference set in [`../research/04-polish-principles.md`](../research/04-polish-principles.md) — Things 3, Linear, Raycast, Notion, Sonoma system apps. The 10 commandments at the bottom of that doc are a checklist every flow below must pass. Doc-Hub is a document registry, not a Finder or Drive clone: projects and documents, permanent hash-chained history, encryption, native editing, content search, compliance.

Each flow maps to a use-case in [`../TESTING.md`](../TESTING.md) (UC-1…UC-10) and must ship with its e2e test.

Convention per flow:

- **Goal** — one sentence; the user's intent.
- **Trigger** — how the user gets here.
- **Happy path** — numbered steps describing what the system does and what the user sees.
- **Keyboard** — shortcuts active in this flow.
- **Copy** — exact strings (button labels, errors, toasts).
- **Polish notes** — motion, focus, timing, microcopy — the details that turn "works" into "feels Doc-Hub-y".
- **Edge cases** — failure modes and recovery.
- **Success criteria** — what counts as the flow shipped (+ the UC it maps to).

Cross-cutting invariants every flow honours:

- Sub-100 ms feedback on every direct manipulation (commandment #5).
- Skeletons not spinners for content (#6).
- Every important action has a shortcut, advertised next to it (#7).
- `prefers-reduced-motion` respected (#8).
- Optimistic UI for any plausibly-safe write; reconcile + roll back on failure.
- One toast for the whole batch on bulk actions — never N toasts for N items.
- **Nothing is ever overwritten or hard-deleted.** Every committed save appends a hash-chained version; every action appends an audit event. "Delete" is a tombstone under retention, never erasure (inviolable rule #6).
- **No plaintext leaves the server unencrypted.** Bytes are encrypted at rest; the editor stream and share bytes ride TLS on their designated origin.

---

## 1 — First-run setup (admin + master key)

**Goal.** An operator who has just deployed Doc-Hub creates the first admin and confirms the encryption key, then lands in an empty hub.

**Trigger.** Fresh deploy, zero users in the DB. `GET /api/setup/status` returns `{needs_setup: true}`. Full spec in [`04-setup-wizard.md`](./04-setup-wizard.md).

**Happy path.**

1. App boot calls `GET /api/setup/status` *before* `/api/me`. On `needs_setup`, the setup wizard renders instead of the sign-in card — a centred card, three steps.
2. **Welcome** — one paragraph on what Doc-Hub is (encrypted, tamper-evident document registry) and a single **Get started** button.
3. **Encryption check** — the wizard confirms the server booted with a master key. Because boot *refuses to start* without `DOCHUB_MASTER_KEY` or a configured KMS, reaching this step already proves a key is present. The step shows the key source read-only: **"Encryption: master key (env)"** or **"Encryption: AWS KMS"**, a `shield-check` glyph, and the line **"Documents are encrypted at rest. Keep this key safe — without it, encrypted documents can't be read."** No key is ever displayed.
4. **Create admin** — username + password + confirm (password ≥ 12 chars). Submit calls `POST /api/setup/admin`; on success the backend mints a session in the same response.
5. **Ready** — **"Welcome, *username*. Opening your hub…"**, a 600 ms beat, then the shell with the empty-hub state.

**Keyboard.** `Enter` advances each step. `Tab`/`Shift-Tab` cycle fields.

**Copy.**
- Welcome title: **"Welcome to Doc-Hub"**, subtitle **"An encrypted, tamper-evident home for your documents."**
- Encryption line: **"Documents are encrypted at rest. Keep this master key safe."**
- Create-admin errors: **"Username must be at least 3 characters."** / **"Password must be at least 12 characters."** / **"Passwords don't match."**
- Ready: **"Welcome, *username*. Opening your hub…"**

**Polish notes.**
- No tutorial overlay after the wizard — the empty-hub state is the welcome.
- The encryption step never asks the operator to type or paste the key. Key management is env/KMS, out of the browser.

**Edge cases.**
- Boot without a key never reaches the wizard — the binary aborts with a clear log line. There is no browser path to run keyless.
- Two operators race the wizard: `POST /api/setup/admin` is transactional; the loser gets 409 and is redirected to sign-in.

**Success criteria (UC-1).**
- First-run wizard → session minted → shell, no sign-in detour.
- An install with no master key never serves the wizard (boot aborts) — asserted in a boot test.

---

## 2 — Sign in

**Goal.** A user authenticates and lands on their hub root.

**Trigger.** Unauthenticated request to any app route → redirect to `/sign-in`. (Once at least one user exists, the setup wizard never shows again.)

**Happy path.**

1. `/sign-in` renders a centred card: Doc-Hub mark, **"Doc-Hub"**, username + password inputs, primary **"Sign in"**. OIDC (Authorization Code + PKCE) is offered as **"Sign in with SSO"** when an IdP is configured.
2. Focus auto-lands on the username input. `--radius-xl`, `--shadow-md`, hairline border.
3. User submits with `Enter` or the button. The button shows a thin inline progress bar across its bottom edge; the label doesn't move.
4. On 200: redirect to the original route or `/`. Session cookie set: `__Host-dh_sid=...; Path=/; Secure; HttpOnly; SameSite=Lax`.
5. On 401: inputs get a 1 px `--danger` border, one-line helper **"Wrong username or password."**, card shakes once (8 px, 250 ms, eased).

**Keyboard.** `Enter` submits. `Tab`/`Shift-Tab` cycle.

**Copy.**
- Heading: **"Doc-Hub"**, subheading **"Sign in to continue."**
- Error: **"Wrong username or password."**
- Lockout after 5 failures: **"Too many attempts. Try again in 10 minutes."**

**Polish notes.**
- Caps-lock detection shows **"Caps Lock is on."** below the input.
- No "Remember me", no social buttons beyond configured OIDC, no marketing footer.

**Edge cases.**
- Rate-limit (10/min/IP, 5/account): button disabled with the lockout message; no live countdown.
- Cookies disabled: banner **"Cookies are required."**

**Success criteria.**
- Sign-in succeeds with password and with OIDC.
- Cookie attributes + lockout verified in integration tests.

---

## 3 — Sign out + session expiry

**Goal.** User signs out cleanly, or a session expires without losing in-progress edits.

**Trigger.** Sign-out from the avatar menu (`Shift-Cmd-Q`), or any backend call returns 401.

**Happy path — sign out.**

1. Avatar menu (Radix dropdown, slide+fade 150 ms): **Account**, **Settings**, separator, **Sign out** (`⇧⌘Q`).
2. POST `/sign-out`; shell fades to half-opacity 80 ms, then `/sign-in`. Server clears `__Host-dh_sid`.
3. `auth.sign_out` is appended to the audit log.

**Happy path — expiry.**

1. A backend call returns 401. The store catches it.
2. Toast: **"Signed out for security."** + action **"Sign back in"**.
3. The app stays mounted read-only; the document the user was viewing stays visible. The action returns them to `/sign-in?return_to=<current>`.
4. An open embedded editor receives `session-expired`; it pauses autosave, shows its own **"Reconnecting…"** banner, and resumes on re-auth without losing the in-memory doc.

**Keyboard.** `Shift-Cmd-Q` sign out; `Esc` closes the avatar menu.

**Copy.** Menu item **"Sign out"** + chord; expiry toast **"Signed out for security."** + **"Sign back in"**.

**Polish notes.** No "Are you sure?" modal — sign out is reversible. On expiry, never blank the screen; only writes are blocked.

**Edge cases.**
- Unsaved editor buffer: the editor holds it in memory and re-commits on re-auth; the version chain is untouched until a real save.
- BFCache stale page: on `pageshow`, ping `/api/me`; 401 fires the expiry flow.

**Success criteria.** Sign-out invalidates the server session (next request 401); expiry preserves view + editor continuity.

---

## 4 — Create project

**Goal.** User creates a project (a team space or personal locker) to hold documents.

**Trigger.** Sidebar **Projects** section → **New project**, or `Cmd-K` → "New project". Every user has a **Personal locker** project created for them; team projects are created on demand.

**Happy path.**

1. A small dialog (Radix Dialog, 440 px): **name** input, optional one-line description, and a **Visibility** note (personal locker vs. team project). For team projects, the creator becomes **Owner**.
2. On **Create**: optimistic — the project appears in the sidebar and becomes the active context; `POST /api/projects {name, description}` runs in background.
3. The project opens to its empty state (flow 5). An audit event `project.create` is appended.
4. Owner can invite members (magic-link) from the project header **Members** control — Owner/Admin/Member roles; ownership transfer is atomic.

**Keyboard.** `Cmd-K` → "New project"; `Enter` creates; `Esc` cancels.

**Copy.**
- Dialog title **"New project"**, placeholder **"Project name"**.
- Empty description helper: **"Optional. What's this project for?"**
- Toast: **"Created project *Compliance 2026*."**
- Error toast: **"Couldn't create project."** + **"Try again"**.

**Polish notes.** No wizard — one field is enough. The Personal locker is never deletable (it's the user's own hub); team projects are.

**Edge cases.**
- Duplicate name in the user's project list: allowed (projects are ID-addressed) but warn inline **"You already have a project named that."** — non-blocking.
- Non-owner tries to create in a restricted org (Phase 4 policy): hide the action.

**Success criteria.** Project is immediately navigable; membership + roles enforced server-side; creation audited.

---

## 5 — Upload a document (documents-only, reject others)

**Goal.** User adds one or many documents to the current project/folder. Non-documents are rejected.

**Trigger.** Toolbar **Upload**, drag-drop onto the window, or `U`. Folder upload via **Upload folder** / `Cmd-Shift-U`.

**Happy path.**

1. Click **Upload** → native picker; the picker's `accept` is pre-filtered to the allowlist (`.docx,.xlsx,.xlsm,.pptx,.pdf,.md,.txt,.csv,.json,.yaml`).
2. Files appear immediately as ghost rows: name, muted size estimate, thin determinate progress bar in `--accent`, an `upload-cloud` overlay on the type glyph.
3. Each file streams via `POST /api/projects/<id>/files?parent=<folder_id>`. The server enforces the allowlist **by extension and magic-byte sniff** and refuses anything else — reject, never quarantine.
4. On 201 the ghost becomes a real row: the row now carries a **v1** version badge (this is the first hash-chained version), progress fades, the glyph resolves to the document type. Bytes were encrypted before touching storage.
5. On all done: one toast **"Uploaded N documents."** + **"Show"**. A background worker enqueues text extraction for search (`index_state = pending`).

**Happy path — drag-drop / folder.** Same queue; folder upload creates the implied folder tree first (`POST /api/projects/<id>/folders/batch`), then uploads (max 4 concurrent).

**Keyboard.** `U` file picker, `Cmd-Shift-U` folder picker, `Esc` cancels the next not-yet-started upload; second `Esc` cancels all queued.

**Copy.**
- Button **"Upload"** + chord `U`.
- Done: **"Uploaded N documents."** / **"Uploaded 1 document."**
- Partial: **"Uploaded 7 of 10. 3 were rejected."** + **"See why"**.
- Rejected (wrong type): **"Only documents can go in the hub. *movie.mp4* isn't a supported type."**

**Polish notes.**
- Ghost row appears in < 60 ms; progress is *real* (server-acknowledged bytes), never a fake 0→100 animation.
- No thumbnails, no media UI — a document glyph and a type label, that's it.
- One toast per batch.

**Edge cases.**

| Failure | Inline | Server |
|---|---|---|
| Disallowed type (mp4, exe, zip, image-as-primary…) | Row turns `--danger-muted`, tooltip **"Not a supported document type."** | 415 |
| Extension allowed but magic bytes disagree | Same rejection — sniff wins | 415 |
| File > size cap | Tooltip **"Too large. Max 100 MB."** | 413 |
| Name collision in target folder | Tooltip actions **Keep both** / **Add as new version** | 409 |
| Network drop mid-upload | Row pauses, retry icon, **"Paused. Retrying…"** | — |
| Storage unreachable | Block-all toast **"Storage is unavailable. Try again."** | 503 |

**Success criteria (UC-2).**
- A `.docx` uploads and lists as **v1**; an `.mp4` (and `.exe`) are rejected on both the proxy and direct-to-storage paths, by extension and sniff.
- No plaintext document bytes reach any storage backend (spy-backend test).

---

## 6 — Open + natively edit a document → new hash-chained version

**Goal.** User opens a document in its embedded native editor, edits, saves; the save appends a new version chained to the previous.

**Trigger.** Double-click a document row, `Enter` on focus, or context-menu **Open**. Embedded editors are the primary path; WOPI is optional interop only (flow references [`08-editor-handoff.md`](./08-editor-handoff.md)).

**Happy path.**

1. User opens `Budget Q2.xlsx`. The row icon pulses once (200 ms).
2. Doc-Hub mints a short-TTL editor access token `(user_id, file_id, perms, exp, jti)` and opens the **embedded** editor in the SPA — Casual Sheet for `.xlsx`, Casual Docs for `.docx`, Casual PDF for `.pdf`, the Markdown editor for `.md`.
3. The server **decrypts the current version's bytes in memory** and streams them to the editor over the authenticated app origin. The editor renders; the current version (e.g. **v3**) is labelled in the editor chrome.
4. User edits. Autosave and manual `Cmd-S` both commit: the edited bytes are **encrypted → written write-once → appended as a new version** with `content_hash = SHA-256(ciphertext)` and `prev_hash =` the previous version's hash. `seq` increments; an audit event `files.edit` is appended; reindex is enqueued.
5. The document header advances to **v4**; the version-history affordance (flow 7) shows the new entry at the top. Nothing was overwritten.

**Keyboard.** `Enter` open. `Cmd-S` save now. `Cmd-Enter` open read-only (no edit token minted). `Esc` closes the editor back to the list.

**Copy.**
- Save toast (only if not autosaving silently): **"Saved as v4."**
- Read-only badge: **"Read-only"**.
- Locked-by-another (co-edit off, single-writer format): **"Someone else is editing. Opening read-only."**

**Polish notes.**
- Bytes never touch a storage backend in plaintext; the decrypt is in-memory and streamed over TLS on the app origin.
- The version number is always visible in the editor chrome — the registry is the point.
- WOPI stays available for external Office clients but is never the default; the embedded editor is what opens on a click.

**Edge cases.**
- Format has no embedded editor (opaque `.xlsm`, `.pptx` until Slides ships): **Open** becomes **Download**; no editor token minted.
- Editor unreachable / not configured: toast **"The editor isn't available on this instance."**; the document stays viewable read-only.
- Session expires mid-edit: flow 3 — editor pauses, resumes on re-auth, chain untouched.

**Success criteria (UC-3).**
- Open→edit→save round-trips `.docx` and `.xlsx` with fidelity parity to the standalone editors.
- N edits yield exactly N chained versions; each new `content_hash` differs from its predecessor; no version is mutated (property test).

---

## 7 — Version history, restore, diff

**Goal.** User inspects a document's full version chain, compares two versions, and restores an old one as a new version.

**Trigger.** Document row → **History** (or the version badge), or the editor chrome's version control. Opens the **History panel** (flow surface in [`02-surface.md`](./02-surface.md)).

**Happy path.**

1. The History panel lists every version newest-first: **vN**, author, timestamp, size, optional **reason**, and a short `content_hash` prefix. A **chain-verified** `shield-check` sits at the top when `verify_chain(file_id)` passes.
2. **View** a version → opens it read-only in the embedded editor.
3. **Diff** — select two versions (or a version against the head) → a content diff renders: text/markdown as line diff; `.xlsx` as changed-cells; `.docx` as tracked prose changes; `.pdf` as a page-level added/removed/changed summary. Diff is derived from `core` extraction, read-only.
4. **Restore vk** → appends a **new** version `vN+1` whose bytes equal `vk`. The old chain is preserved; `vk` and everything after it stay. An audit event `files.restore` records `{restored_from: k}`.
5. Toast: **"Restored v2 as v6."** The head advances; history now shows v6 at the top.

**Keyboard.** In the panel: `↑↓` move, `Enter` view, `D` diff-select, `R` restore.

**Copy.**
- Panel title **"Version history"**.
- Restore confirm (inline, not a modal): **"Restore v2? This adds a new version — nothing is lost."** + **Restore** / **Cancel**.
- Restore toast: **"Restored v2 as v6."**
- Tamper banner (chain broken): **"Chain verification failed at v4. This document may have been tampered with. An admin has been notified."** in `--danger`.

**Polish notes.**
- Restore is framed as additive everywhere — no "overwrite" language, no destructive styling.
- A verified chain shows a quiet checkmark; a broken chain is loud and audited, never silently repaired.

**Edge cases.**
- Chain break detected: surface the banner, append an audit alarm, disable restore until an admin acknowledges — never auto-fix.
- Restoring a version whose blob is under legal hold: still additive; the old blob is retained regardless.

**Success criteria (UC-4).**
- Restore vk yields v(N+1) byte-equal to vk, with vk and the chain preserved (property test).
- Corrupting any stored version makes `verify_chain` fail at that link; an intact chain always verifies.

---

## 8 — Co-edit a document

**Goal.** Two or more members edit the same team document at once; both saves land as ordered versions.

**Trigger.** A second member opens a document already open by a first, in a team project with co-editing enabled.

**Happy path.**

1. Member A opens `Plan.docx` in the embedded editor. Member B opens the same document.
2. Both editors connect to the `collab` server (Yjs/Hocuspocus), which relays **opaque document bytes** and never parses them. Presence appears: coloured cursors + an avatar stack in the editor chrome (**"A and B editing"**).
3. Edits merge live via CRDT. Saves are debounced and coordinated: each committed save appends a **single ordered version** with the correct `prev_hash`; concurrent edits do not fork the chain — the collab session serialises commits.
4. Audit events attribute each committed version to its author. The History panel (flow 7) shows an ordered sequence, not a branch.

**Keyboard.** Standard editor shortcuts; `Cmd-S` requests a checkpoint save.

**Copy.**
- Presence: **"A and B editing"**.
- Reconnect banner: **"Reconnecting to the live session…"**.

**Polish notes.** Presence is calm — cursors and a small avatar stack, no confetti. The chain stays linear and verifiable even under concurrency; that invariant outranks UI flourish.

**Edge cases.**
- Collab server unreachable: the editor falls back to single-writer with a banner **"Live editing is offline — you're editing alone."**; saves still append versions.
- A member loses connection mid-edit: their buffer replays on reconnect; no version is lost or duplicated.

**Success criteria (UC-5).**
- Two browsers co-edit one document; both saves land as ordered, hash-chained versions; the chain still verifies.

---

## 9 — Content search

**Goal.** User finds documents by what's *inside* them, not just by name.

**Trigger.** `Cmd-K` palette, or the search field in the top bar (which focuses the palette). Full-text over document content via `core` extraction + Tantivy.

**Happy path.**

1. Palette opens; placeholder **"Search inside your documents…"**.
2. As the user types, results stream in grouped sections:
   - **Documents** — content hits with a **snippet** and highlighted match, plus the project/folder path muted on the right and the matching **version** if not the head.
   - **Commands** — actions (New project, Upload, Settings…) with chord chips.
3. Filters chips under the input: **Type** (docx/xlsx/pdf/md/txt/csv/json/yaml), **Project**, **Date**. "Which document mentions X" is the primary framing.
4. `↑↓` navigate, `Enter` opens the document (scrolled/anchored to the hit where the editor supports it), `Esc` closes.

**Keyboard.** `Cmd-K` open, arrows navigate, `Enter` open, `Esc` close.

**Copy.**
- Placeholder **"Search inside your documents…"**.
- Empty: **"Search across every document's contents."** + a **Recent** group.
- No results: **"No documents match \"…\"."**
- Indexing notice on a fresh doc: muted **"Still indexing — content search will catch up shortly."**

**Polish notes.**
- Search reads content, not filenames only — snippets are the whole point.
- Results are debounced 80 ms; skeleton rows while the index responds, never a spinner.
- A tombstoned document is removed from the index and never appears.

**Edge cases.**
- A document whose extraction failed shows `index_state = failed`; it's findable by name/metadata with a muted **"content not searchable"** note.
- Encrypted-at-rest is transparent to search: the server decrypts to extract, indexes the text, and the index itself lives inside the trust boundary.

**Success criteria (UC-6).**
- A phrase that exists only *inside* a `.pdf`/`.xlsx`/`.docx` is found with a snippet; reindex fires on a new version; the index entry is removed on tombstone.

---

## 10 — Share a document

**Goal.** User creates a link to a document with optional password and expiry, served on the isolated user-content origin.

**Trigger.** Row context-menu **Share…**, selection **Share**, or `Cmd-Shift-S`. Full surface in [`05-sharing-surface.md`](./05-sharing-surface.md).

**Happy path.**

1. Share modal opens (Radix Dialog, 460 px): title **"Share *Q2 planning.xlsx*"**, a link card, and collapsible options.
2. The user clicks **Copy link** (or opens options first). Options: **Permission** (View in v0; Edit reserved), **Expires** (Never / 7 days / 30 days / a date — default 7 days), **Password** (optional, Argon2id).
3. On first option change (or Copy), the link is created: a 128-bit token, URL-safe base64, on the user-content origin. Copy shows an inline check + **"Copied"** for 1.4 s — no toast.
4. Existing links list below: token prefix, permission, expiry, access count, **Copy** / **Revoke**.
5. An audit event `share.create` is appended; each recipient access appends `share.access` (anonymous actor).

**Keyboard.** `Cmd-Shift-S` open, `Cmd-C` copy focused link, `Esc` close.

**Copy.**
- Title **"Share *<name>*"**; caption **"Anyone with this link can view."**
- Revoke confirm (inline): **"Revoke this link?"** + **Revoke** / **Cancel**.

**Polish notes.**
- Recipient bytes are served from the user-content origin (`CSP: sandbox; default-src 'none'`, no cookies, `Content-Disposition: attachment`), never the app origin.
- Each recipient request mints a fresh short-TTL signed URL — the link is not equivalent to the bytes.
- Revoking or expiring a link never touches the document or its history.

**Edge cases.**
- Document tombstoned while modal open: inline **"This document no longer exists."**
- Rate-limit on link creation: **"Try creating links a bit slower."**

**Success criteria (UC-7).**
- A password+expiry link opens on the user-content origin; an expired link 404s; a revoked link is inert. View-only is enforced even if a recipient sniffs the token.

---

## 11 — Audit & retention

**Goal.** User reviews the append-only, hash-chained activity feed, exports a verifiable report, and confirms retention / legal hold protects held documents.

**Trigger.** Sidebar → **Activity**, or Settings → **Audit log**. Surface in [`06-activity-surface.md`](./06-activity-surface.md).

**Happy path.**

1. **Activity** shows a day-grouped, newest-first timeline. Each row: `[hh:mm] [action-pill] [sentence] [metadata]`. The feed is the `audit_log`, which is **append-only and hash-chained** — every row carries `prev_hash`; the header shows a **chain-verified** badge.
2. **Export report** → downloads a signed JSONL (or PDF summary) of the selected range. The export includes each event's hash and the chain head so it **verifies offline** against the chain.
3. **Retention** — an admin sets retention policies (Settings → Retention); tombstoned documents obey the policy and are only purged when their retention window elapses and no hold applies.
4. **Legal hold** — placing a hold on a document (or project) blocks tombstone and purge on every path. Held rows show a `lock` glyph and **"On legal hold"**.

**Keyboard.** `Cmd-K` → "Export audit report"; row hover exposes **Copy event JSON**.

**Copy.**
- Header **"Activity"**, subtitle **"Every action in this hub, newest first. Append-only and tamper-evident."**
- Export button **"Export report"**; toast **"Exported audit report (verifiable)."**
- Hold banner on a document: **"On legal hold — can't be deleted."**
- Delete attempt on a held doc: **"This document is on legal hold and can't be moved to trash."**

**Polish notes.**
- The audit feed is never editable — no row has an edit affordance; that would violate append-only.
- Export is framed around verifiability, not just download.

**Edge cases.**
- Audit chain break: a loud banner + an out-of-band admin alert; the export flags the break rather than hiding it.
- Purge attempt under active hold: refused by every path (property/integration test).

**Success criteria (UC-8).**
- Actions appear in order; an exported report is complete and hash-verifiable offline; a held document resists deletion by any path.

---

## 12 — Provenance (signed documents)

**Goal.** A registrar issues a signed, verifiable document; a recipient verifies its signature and chain offline.

**Trigger.** Document → **Sign / Issue** (registrar role, Phase 4), or verifying a received document via **Verify**. Ed25519 provenance signing.

**Happy path.**

1. A registrar selects a document version and **Issues** it: the server signs `(content_hash, file_id, version, issuer_id, issued_at)` with the workspace's Ed25519 provenance key. A provenance record is appended (immutable).
2. The document shows a **Verified** badge with issuer, date, and the signed version. Downloading the provenance bundle yields the version bytes' hash, the signature, and the public key reference.
3. A recipient runs **Verify** (in-app or with the offline verifier): the tool recomputes `content_hash`, checks the Ed25519 signature, and walks the chain. Green when all pass.
4. Optional: chain heads are periodically anchored (transparency-log-lite) for third-party-verifiable provenance.

**Keyboard.** `Cmd-K` → "Verify document".

**Copy.**
- Badge **"Verified — issued by *Registry Office* on 3 Jul 2026 (v5)."**
- Verify success: **"Signature and chain verified."**
- Verify failure: **"Verification failed — signature or content doesn't match."** in `--danger`.

**Polish notes.** Provenance is DigiLocker-style: a document you can *prove*, offline, without trusting the server that stored it. The AI layer never issues or mutates signatures — signing is a deliberate registrar action.

**Edge cases.**
- Bytes altered after issuance: verification fails at the hash step and names the failing version.
- Issuer key rotated: verification uses the key valid at issuance time (key id is recorded in the provenance row).

**Success criteria (UC-9).**
- A registrar issues a signed document; a recipient verifies its signature + chain offline with no server call.

---

## 13 — Browse projects, folders, documents

**Goal.** User navigates projects and folders and finds a document.

**Trigger.** Sidebar project, folder row, or breadcrumb.

**Happy path.**

1. Sidebar lists **Projects** (Personal locker + team projects). Selecting one sets the active context; the main pane lists its folders and documents.
2. Single click selects a row; double-click / `Enter` opens (folder → navigate, document → editor per flow 6). `Cmd-Down` enters, `Cmd-Up` climbs.
3. Breadcrumbs: `Compliance 2026 › Contracts › 2026`. Segments clickable; long paths truncate the middle with **…**.
4. List columns: **Name**, **Modified**, **Size**, **Type**, **Version** (current vN). No thumbnails, no media columns.
5. Documents on legal hold show a `lock` glyph; verified documents show a small `shield-check`.

**Keyboard.** `↑↓` focus, `Enter` open, `Cmd-Up` parent, `Home`/`End` first/last, letter-jump (sticky 1 s), `Backspace` trashes (tombstone).

**Copy.**
- Empty project: **"This project has no documents yet."** + muted **"Upload documents or create one."**
- Empty folder: **"This folder is empty."**

**Polish notes.** Cross-fade on navigation (120 ms), not a slide. Tabular numerals, right-aligned Size and Version. This is a registry list — calm, dense, legible.

**Edge cases.**
- Folder removed by another session: route falls back to the project root with a toast **"That folder no longer exists."**
- 10k-document folder: virtualised list renders smoothly.

**Success criteria.** Sub-100 ms render into a pre-fetched folder; back/forward correct; version column always reflects the head.

---

## 14 — Delete → trash (tombstone) + restore

**Goal.** User sends a document to trash (a tombstone under retention), and can restore it — bytes and history are never erased.

**Trigger.** `Backspace`/`Delete`, context-menu **Move to trash**, or the trash action.

**Happy path.**

1. Rows fade out; toast **"Moved 3 documents to trash."** + **Undo** (8 s).
2. `POST /api/files/trash {ids}` sets a tombstone (`trashed_at`, original parent saved). **No bytes are removed** — blobs, versions, and the hash chain stay intact under retention.
3. Trash view lists tombstoned documents with original location and age. **Put back** restores to the original folder (or the project root if it's gone).
4. Retention: a tombstone is only eligible for purge when its retention window elapses **and** no legal hold applies. Purge, when it happens, is server-side and audited — never a user's "empty trash forever" gesture on held data.

**Keyboard.** `Backspace`/`Delete` trash; in Trash view `R` restores.

**Copy.**
- Toast **"Moved *Contract.pdf* to trash."** + **Undo**.
- Held-document refusal: **"This document is on legal hold and can't be moved to trash."**
- Trash header: **"Trashed documents are retained under policy, not deleted immediately."**

**Polish notes.** "Delete" never reads as erasure. There is no user-facing "permanently delete now" for documents under retention or hold — that's the product promise. Any hard purge is governed by retention policy, executed server-side, and logged.

**Edge cases.**
- Trashing a document open in an editor: refuse, **"Can't trash *Plan.docx* — it's open."**
- Trashing a held document: refused everywhere.

**Success criteria.** Trash is reversible; held documents cannot be tombstoned; no path reduces the version count or removes chained bytes.

---

## 15 — Recipient opens a share-link

**Goal.** Someone with a link accesses the document, optionally entering a password, and downloads or opens a read-only view.

**Trigger.** Recipient opens `https://usercontent-dochub.<host>/s/<token>` (the recipient page renders on the app origin; bytes come from the user-content origin).

**Happy path — no password.**

1. Server validates the token. A stripped page shows: document name, type, size, **"Shared by *owner*"**, and a primary **Download** (or **Open read-only** for previewable documents).
2. Read-only preview (docx/xlsx/pdf/md/txt/csv/json/yaml) renders per [`07-preview-surface.md`](./07-preview-surface.md) — document formats only, no media.
3. Each access appends `share.access` to the audit log.

**Happy path — with password.**

1. A password page: **"This link requires a password."** + input + **Continue** (`POST`, so the password never lands in history/referer).
2. Server validates constant-time; on success serves the view. Wrong passwords are rate-limited.

**Keyboard.** `Enter` submits.

**Copy.**
- View title **"Shared with you"**; button **"Download"** / **"Open read-only"**.
- Password page **"This link requires a password."**; wrong **"Wrong password."**
- Expired **"This link expired on 12 May."**; revoked/not-found **"This link is no longer active."** (never disambiguate — anti-enumeration).

**Polish notes.** Recipient chrome is stripped — no sidebar, no hint of the hub behind it. Optional **"Powered by Doc-Hub"** footer, operator opt-in.

**Edge cases.**
- Link to a tombstoned document: **"This link is no longer active."** (don't disclose trash state).
- View-only enforcement: even a sniffed token can't fetch editable bytes — the perms claim gates it.

**Success criteria.** Recipient flow works with no Doc-Hub account; password + expiry + revoke enforced; bytes served only from the user-content origin.

---

## 16 — AI assist (optional, read-only)

**Goal.** User uses the optional AI layer for semantic search, summaries, PII detection, and cross-document Q&A — without ever mutating documents or history.

**Trigger.** AI panel in a document or the search palette's **Ask** tab (only present when `dochub-ai` is configured). Provider is pluggable — default Claude via the Anthropic API (Haiku for extraction/classification, Sonnet/Opus for reasoning); local-model option for air-gapped installs.

**Happy path.**

1. **Semantic search** — a natural-language query returns documents a keyword search misses, reranked alongside Tantivy exact hits (never replacing them for compliance-critical retrieval).
2. **Summary** — the AI panel offers a document/section summary; it's a read-only suggestion, clearly labelled **AI**.
3. **PII / entity detection** — from a document's **Details** compliance panel, **Scan for personal data** (`POST /api/files/{id}/pii`) flags suspected PII (email, payment card, US SSN, IP) as *suggestions*, each shown **masked** (`•••• 1111`) with a kind label. A human approves any resulting action (e.g. tagging). The scan is read-only and audited (`pii.scan`); the AI never redacts or edits. Unsupported formats (pdf/xlsm) say so rather than erroring.
4. **Cross-document Q&A** — "which contract has the 30-day termination clause?" returns cited passages with document + version links.
5. Every AI action is audited (`ai.query`, `ai.summary`, …). No AI action creates or changes a version.

**Keyboard.** `Cmd-K` → **Ask**; `Enter` submits the question.

**Copy.**
- Panel label **"AI (read-only)"**; disclaimer **"Suggestions only — AI never changes your documents or their history."**
- No-provider state: **"AI isn't enabled on this instance."**

**Polish notes.** AI is visibly bounded: labelled, cited, read-only, audited. Semantic results sit *beside* exact search, so compliance retrieval never silently defers to a model.

**Edge cases.**
- Provider unreachable / rate-limited: the panel degrades to exact search with a quiet note; no error spew.
- Air-gapped install: the local-model adapter serves the same surface; no outbound calls.

**Success criteria (UC-10).**
- A semantic query surfaces a document keyword search misses; PII detection flags known fixtures; every AI action is read-only and audited — no document or history mutation.

---

## What this doc deliberately doesn't cover (deferred)

In priority order:

1. **Retention-policy admin UI** — full editor for policies + legal-hold management (flow 11 covers the user-facing surface; the admin editor lands Phase 4).
2. **Registrar / issuer management** — issuing keys, issuer directory, revocation (flow 12 extends here).
3. **Diff depth** — richer semantic diffs per format beyond the v0 line/cell/page summaries.
4. **Bulk operations** across projects (bulk move, bulk share) with a single-toast summary.
5. **Keyboard cheat sheet** — `?` opens a Cmd-K-style reference.
6. **Theme toggle** — sun/moon in the avatar menu.
7. **Public landing** for an unauthenticated visitor at `/` — a small "This is a private Doc-Hub instance" card with a Sign in link.
