# 09 — Notes / Wiki

Pipeline §8.11. Personal + workspace-scoped pages with a markdown body, a hierarchical tree, and `[[wiki-link]]` backlinks. A new left-rail surface beside My Drive.

## Goals

1. Capture the thoughts that don't belong in a file: meeting notes, READMEs, runbooks, scratch pads.
2. Surface them where they're needed — workspace-scoped pages live with the team; personal pages stay private.
3. Keep the data portable. Export = `git clone` your bucket; each note is a plain markdown file.
4. Same shipping bar as the rest of Drive: macOS-app polish, mobile-first, fully keyboarded.

## Locked decisions (with rationale)

### Editor: markdown source + live preview, NOT Lexical (yet)

- **Lexical** gives a richer experience but explodes the storage shape (JSON tree, schema drift on each release), drags ~150 KB of JS into the SPA, and ruins the "export = `cat` it" story.
- **Plain markdown** stores as one text blob per note. Authors who don't write markdown get a rendered preview alongside the source; markdown writers get a fast textarea. We can swap in Lexical in v0.3 without a migration.
- Renderer: `marked` (already a SPA dep) + `dompurify` (also already in). No new packages.
- Editor: a polished `<textarea>` with autosize + tab-to-indent. CodeMirror is overkill for paragraphs of prose.

### Storage: dedicated `notes` table, NOT file blobs

- A note is logically distinct from a file. Mixing the two means every "list files" path has to filter, every preview branch has to handle `text/markdown`, every share-link surface gets confused.
- Body lives **in the database** (TEXT). Notes are small (kilobytes), text, and queried often — perfect fit for SQL.
- Reuses workspace + ownership conventions verbatim. Adds two tables (`notes`, `note_links`) and one route family (`/api/notes/...`).

### Scope: workspace-scoped (default) + personal (Personal workspace)

- Same model as files. Notes live in a workspace. Personal workspace = personal notes. Team workspace = team notes.
- No "shared with me" surface in v0 — that's the same gap files have today.
- The WorkspaceContext drives note scope identically. Switching workspace re-scopes the tree.

### Wiki-style links: `[[Page Title]]` (case-insensitive match)

- Markdown rendering replaces `[[Title]]` with a link to the matching page (workspace-scoped).
- If the title doesn't exist, the link renders as `[[Title]]` styled red — clicking creates a new page with that title.
- Backlinks live in a `note_links` table; we re-index every save (parse `[[…]]` tokens, diff against existing rows, upsert). Indexing happens server-side so all clients see the same view.

### Tree: pages have `parent_id` (acts as a folder)

- A page can have child pages. No separate folder concept — every node is editable.
- Default sort = manual order via `order_key` column (lexicographic strings, easy reordering without renumbering).
- "Root" pages have `parent_id = NULL`.

## Schema (migration 0008)

```sql
CREATE TABLE notes (
  id              TEXT PRIMARY KEY,         -- ULID
  workspace_id    TEXT NOT NULL,
  parent_id       TEXT,                     -- NULL = root
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  owner_id        TEXT NOT NULL,            -- creator; doesn't gate edits in v0
  order_key       TEXT NOT NULL,            -- lexicographic ordering within siblings
  trashed_at      TEXT,
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
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

Why `target_title` is stored even when `target_id` resolves: titles get renamed; the link should follow the title (a "redirect" UX in a follow-up), not silently break.

## Backend contract

| Method | Path | Notes |
|---|---|---|
| `GET`   | `/api/notes/tree?workspace=<id>` | Hierarchical tree of titles + ids, sorted by `order_key`. Non-trashed only. |
| `GET`   | `/api/notes/{id}` | Body + metadata + computed backlinks (notes that link to this one). |
| `POST`  | `/api/notes` | `{ workspace_id?, parent_id?, title }`. Returns the new row. Body starts empty. |
| `PATCH` | `/api/notes/{id}` | `{ title?, body?, parent_id?, order_key? }`. Body changes re-index `note_links`. |
| `POST`  | `/api/notes/{id}/trash` | Soft delete. |
| `POST`  | `/api/notes/{id}/restore` | Undo. |
| `DELETE`| `/api/notes/{id}` | Hard delete. Idempotent. |
| `GET`   | `/api/notes/search?workspace=<id>&q=…` | Substring on title + body, max 50. Falls back gracefully on backends without FTS. |

All gated by workspace membership (reuses `resolve_active_workspace`). Member-rank or higher = edit; v0 doesn't distinguish view-only.

## Indexing pipeline

On every body save:

1. Parse the new body for `\[\[([^\]]+)\]\]` tokens.
2. Lowercase + trim each match → set of `target_title`s.
3. `DELETE FROM note_links WHERE note_id = ?` then bulk-insert the new set.
4. For each `target_title`, attempt to resolve to a note in the same workspace; set `target_id` (or leave NULL).

Backlinks lookup at read time:

```sql
SELECT n.id, n.title FROM note_links l
JOIN notes n ON n.id = l.note_id
WHERE l.target_id = ?  -- or l.target_title = LOWER(?)
  AND n.trashed_at IS NULL
ORDER BY n.modified_at DESC
LIMIT 50;
```

Performance: notes are O(thousands per workspace) for years. The schema doesn't need FTS in v0 — `LIKE LOWER('%...%')` on indexed columns is fine. A `tsvector` (Postgres) / FTS5 (SQLite) layer drops in cleanly later.

## Audit

| Action | Metadata |
|---|---|
| `notes.create` | title |
| `notes.rename` | old_title → new_title |
| `notes.edit` | byte_delta |
| `notes.move` | old_parent_id → new_parent_id |
| `notes.trash` | — |
| `notes.restore` | — |
| `notes.delete` | title |

## Out of scope (v0.2+)

- Rich text (Lexical), tables, embeds. Markdown only.
- Comments / threaded discussions.
- Real-time collab. Editing is single-user-at-a-time; last-write-wins on conflict.
- Public publishing (a la Notion). Notes are workspace-only.
- Templates.
- Tags.
- File attachments inside a note. The Drive's file list is the attachment surface.
- Export as PDF / DOCX.
- Cross-workspace links.
- Renaming with redirect — title rename today breaks dangling backlinks.

## Performance & polish budget

- Tree load < 80 ms for 500 notes (single SQL query, group in handler).
- Note open < 100 ms (single row + 1 join for backlinks).
- Save debounced 600 ms; the UI shows a tiny "Saving…" → "Saved 2s ago" microstate.
- Markdown preview rerenders in < 50 ms for notes up to 50 KB.
- Mobile: editor + preview tab-toggle (vaul drawer); no side-by-side on viewports < 1024.
