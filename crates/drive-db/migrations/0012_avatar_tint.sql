-- Phase 3 §14 — presence. Stable per-user avatar monogram tint, so the
-- sidebar avatar stack and file-row dots paint the same colour every
-- render (and across machines). Nullable: existing rows pick a tint
-- deterministically from their user_id; users can override later.
ALTER TABLE users ADD COLUMN avatar_tint TEXT;
