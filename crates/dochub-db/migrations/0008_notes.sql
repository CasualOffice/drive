-- Pipeline §8.11 — Notes / Wiki.
-- Spec: docs/research/09-notes-wiki.md, docs/ux/16-notes-surface.md.
--
-- Two tables: `notes` for the page tree + body, `note_links` for the
-- backlinks index. The index is re-derived on every body save by parsing
-- `[[wiki-style]]` tokens out of the markdown source.
--
-- Body lives in the database (TEXT). Notes are small (kilobytes), queried
-- often, never serve as raw bytes to a browser — perfect SQL territory.
-- Personal workspace = personal notes; team workspace = team notes.

CREATE TABLE notes (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  parent_id       TEXT,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL DEFAULT '',
  owner_id        TEXT NOT NULL,
  -- Lexicographic sibling order. Crockford-style midpoint inserts give
  -- O(1) reorders without renumbering — see drive-db::notes::order_key.
  order_key       TEXT NOT NULL,
  trashed_at      TEXT,
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id)    REFERENCES notes(id)      ON DELETE SET NULL
);

CREATE INDEX notes_workspace_id_idx ON notes(workspace_id);
CREATE INDEX notes_parent_id_idx    ON notes(parent_id);

-- Backlinks table. `target_title` is the lowercased title from the
-- `[[…]]` token; `target_id` resolves it within the SAME workspace at
-- index time (NULL = dangling). We store both because titles rename and
-- the link should follow the title — Phase 2 turns dangling links into
-- redirects without breaking the existing rows.
CREATE TABLE note_links (
  note_id         TEXT NOT NULL,
  target_title    TEXT NOT NULL,
  target_id       TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (note_id, target_title),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX note_links_target_id_idx    ON note_links(target_id);
CREATE INDEX note_links_target_title_idx ON note_links(target_title);
