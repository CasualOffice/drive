# 09 — Notes / Wiki

Pipeline §8.11. Personal + project-scoped pages with a markdown body, a hierarchical tree, and `[[wiki-link]]` backlinks. A supported document surface inside the hub, beside the document list.

Notes are **documents**, not a side channel. A note is a `.md` document (already on the ingest allowlist); it is encrypted at rest, hash-chained versioned, tombstoned-not-deleted, and audited exactly like any other document in the hub. The notes surface adds a tree, a title, and wiki-link backlinks on top of that spine — it does not opt out of the immutability guarantees.

## Goals

1. Capture the thoughts that don't belong in a standalone upload: meeting notes, READMEs, runbooks, decision records — as first-class, versioned hub documents.
2. Surface them where they're needed — project-scoped pages live with the team; personal pages stay in the personal locker.
3. Keep the data portable and provable. Every save is a new hash-chained version; export includes the provenance chain, not just the current text.
4. Same shipping bar as the rest of the hub: macOS-app polish, mobile-first, fully keyboarded, encrypted, append-only.

## Locked decisions (with rationale)

### Editor: markdown source + live preview in v0, live-render pivot tracked separately

- **Plain markdown** is the canonical body format (`text/markdown`, on the ingest allowlist). Authors who don't write markdown get a rendered preview alongside the source; markdown writers get a fast textarea.
- Renderer: `marked` (already a SPA dep) + `dompurify` (also already in). No new packages.
- Editor: a polished `<textarea>` with autosize + tab-to-indent. CodeMirror is overkill for paragraphs of prose.
- The general-user live-render pivot (Tiptap, single pane, slash menu) is specced in [`17-notes-general-user-ux`](./17-notes-general-user-ux.md); it keeps markdown as the on-disk format, so it does not disturb the versioning or backlink substrate below.

### Storage: notes are versioned documents, not plaintext DB rows

- A note is logically a document. Its body is stored the same way as every document: encrypted with the workspace DEK (AES-256-GCM envelope), written write-once and content-addressed, and appended as a new hash-chained `file_versions` row on each save. **No plaintext note body is ever written to a storage backend** — the same rule that governs uploads.
- A `notes` table carries only the *metadata* the document layer doesn't: tree position (`parent_id`, `order_key`) and the resolved title. It points at a `files` row (`file_id`); the file's version chain is the note's history.
- This is the deliberate change from the former Drive design (body-in-DB TEXT). Storing note bodies as plaintext DB rows would break both "no plaintext at rest" and "history is append-only." Notes join the registry instead of dodging it.
- Reuses workspace + ownership + version + audit conventions verbatim. Adds two metadata tables (`notes`, `note_links`) and one route family (`/api/notes/...`) over the existing document engine.

### Scope: project-scoped (default) + personal (personal locker)

- Same model as documents. Notes live in a project/workspace. Personal locker = personal notes. Team project = team notes.
- No "shared with me" surface in v0 — the same gap documents have today.
- The WorkspaceContext drives note scope identically. Switching workspace re-scopes the tree.

### Wiki-style links: `[[Page Title]]` (case-insensitive match)

- Markdown rendering replaces `[[Title]]` with a link to the matching page (workspace-scoped).
- If the title doesn't exist, the link renders as `[[Title]]` styled red — clicking creates a new page with that title.
- Backlinks live in a `note_links` table; we re-index on every committed version (parse `[[…]]` tokens, diff against existing rows, upsert). Indexing happens server-side so all clients see the same view.

### Tree: pages have `parent_id` (acts as a folder)

- A page can have child pages. No separate folder concept — every node is editable.
- Default sort = manual order via `order_key` column (lexicographic strings, easy reordering without renumbering).
- "Root" pages have `parent_id = NULL`.

## Schema (migration 0008)

```sql
CREATE TABLE notes (
  id              TEXT PRIMARY KEY,         -- ULID
  workspace_id    TEXT NOT NULL,
  file_id         TEXT NOT NULL,            -- the .md document; its version chain is the note history
  parent_id       TEXT,                     -- NULL = root
  title           TEXT NOT NULL,
  owner_id        TEXT NOT NULL,            -- creator; doesn't gate edits in v0
  order_key       TEXT NOT NULL,            -- lexicographic ordering within siblings
  tombstoned_at   TEXT,                     -- soft delete; obeys retention + legal hold, never hard-erased
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id)      REFERENCES files(id),
  FOREIGN KEY (parent_id)    REFERENCES notes(id)      ON DELETE SET NULL
);
CREATE INDEX notes_workspace_id_idx ON notes(workspace_id);
CREATE INDEX notes_parent_id_idx    ON notes(parent_id);
CREATE INDEX notes_title_idx        ON notes(workspace_id, LOWER(title));

CREATE TABLE note_links (
  note_id         TEXT NOT NULL,            -- the note containing the link
  target_title    TEXT NOT NULL,            -- the lowercased title from [[…]]
  target_id       TEXT,                     -- resolved note id; NULL = dangling
  created_at      TEXT NOT NULL,
  PRIMARY KEY (note_id, target_title),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX note_links_target_id_idx    ON note_links(target_id);
CREATE INDEX note_links_target_title_idx ON note_links(target_title);
```

Note the body is **not** a column: it lives in the encrypted, hash-chained `file_versions` blob the `file_id` points at. `tombstoned_at` replaces a hard delete — a note under legal hold or retention cannot be erased.

Why `target_title` is stored even when `target_id` resolves: titles get renamed; the link should follow the title (a "redirect" UX in a follow-up), not silently break.

## Backend contract

| Method | Path | Notes |
|---|---|---|
| `GET`   | `/api/notes/tree?workspace=<id>` | Hierarchical tree of titles + ids, sorted by `order_key`. Non-tombstoned only. |
| `GET`   | `/api/notes/{id}` | Current body (decrypted from the head version) + metadata + computed backlinks. |
| `GET`   | `/api/notes/{id}/history` | The note's version chain (who/when/why/hash), reusing the document history endpoint. |
| `POST`  | `/api/notes` | `{ workspace_id?, parent_id?, title }`. Creates the `.md` document + metadata row. Body starts empty (v1). |
| `PATCH` | `/api/notes/{id}` | `{ title?, body?, parent_id?, order_key? }`. A `body` change **commits a new encrypted, hash-chained version** + audit event, then re-indexes `note_links`. |
| `POST`  | `/api/notes/{id}/restore-version` | Restore a prior version as a new head version (additive; destroys nothing). |
| `POST`  | `/api/notes/{id}/trash` | Tombstone. Obeys retention + legal hold. |
| `POST`  | `/api/notes/{id}/restore` | Undo a tombstone. |
| `GET`   | `/api/notes/search?workspace=<id>&q=…` | Content search over title + body via the `core` + Tantivy index; falls back to substring on backends without it, max 50. |

All gated by workspace membership (reuses `resolve_active_workspace`). Member-rank or higher = edit; v0 doesn't distinguish view-only. There is no hard-delete route — nothing in the hub erases committed history.

## Indexing pipeline

On every committed body version:

1. Parse the new body for `\[\[([^\]]+)\]\]` tokens.
2. Lowercase + trim each match → set of `target_title`s.
3. `DELETE FROM note_links WHERE note_id = ?` then bulk-insert the new set. (This is derived link metadata, not committed history — safe to recompute.)
4. For each `target_title`, attempt to resolve to a note in the same workspace; set `target_id` (or leave NULL).
5. Enqueue the new version for full-text reindex (`core` extraction → Tantivy), same worker every document uses.

Backlinks lookup at read time:

```sql
SELECT n.id, n.title FROM note_links l
JOIN notes n ON n.id = l.note_id
WHERE l.target_id = ?  -- or l.target_title = LOWER(?)
  AND n.tombstoned_at IS NULL
ORDER BY n.modified_at DESC
LIMIT 50;
```

Performance: notes are O(thousands per workspace) for years; `note_links` on indexed columns stays cheap. Content search rides the shared Tantivy index, so "which note mentions X" works the same as it does for uploads.

## Audit

Every action appends to the shared append-only, hash-chained `audit_log` — committed rows are never updated or deleted.

| Action | Metadata |
|---|---|
| `notes.create` | title, file_id |
| `notes.rename` | old_title → new_title |
| `notes.edit` | version seq, content_hash, byte_delta |
| `notes.restore_version` | restored_seq → new_seq |
| `notes.move` | old_parent_id → new_parent_id |
| `notes.trash` | — |
| `notes.restore` | — |

There is no `notes.delete` — a note is tombstoned, never erased.

## Out of scope (v0.2+)

- Rich text (Lexical/Tiptap live-render) — tracked in [`17-notes-general-user-ux`](./17-notes-general-user-ux.md); markdown stays the canonical storage format either way.
- Comments / threaded discussions.
- Real-time co-editing — arrives with the hub's `collab` server pass; single-user last-write-wins in v0, but each write is still its own version.
- Public publishing (a la Notion). Notes are workspace-only; sharing goes through the same password+expiry share links documents use, on the user-content origin.
- Templates.
- Tags.
- Document embeds inside a note. The hub's document list is the attachment surface.
- Export as PDF / DOCX (provenance-chain export of the version history ships first).
- Cross-workspace links.
- Renaming with redirect — title rename today breaks dangling backlinks.

## Performance & polish budget

- Tree load < 80 ms for 500 notes (single SQL query, group in handler).
- Note open < 100 ms (metadata row + decrypt head version + 1 join for backlinks).
- Save debounced 600 ms; the UI shows a tiny "Saving…" → "Saved 2s ago" microstate; each flush is a committed version.
- Markdown preview rerenders in < 50 ms for notes up to 50 KB.
- Mobile: editor + preview tab-toggle (vaul drawer); no side-by-side on viewports < 1024.
