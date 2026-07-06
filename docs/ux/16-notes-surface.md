# 16 — Notes surface

Companion to `docs/research/09-notes-wiki.md`. The Notes app inside Doc-Hub — a left-rail surface beside Documents, project-scoped, markdown. Notes are the hub's lightweight, always-editable text lane (meeting minutes, runbooks, decision logs); they live alongside the versioned document registry and share its encryption and audit guarantees.

> Notes bodies are stored the same way as documents: **encrypted at rest** under the project DEK, never plaintext on a backend. Unlike documents, a note is a single mutable record with last-write-wins semantics rather than a hash-chained version chain — but every save is audited, and `md` export drops a note into the versioned document registry when a note graduates into a tracked artifact.

## Flow

1. **Land.** User clicks "Notes" in the sidebar. Empty state if the project has no notes yet → primary CTA "Write your first note".
2. **Create.** Click "+ New page" (or `Cmd-N`). A new untitled note slides in, title focused. Hit `Enter` → focus moves to body.
3. **Write.** Plain markdown in the left pane, rendered preview in the right (desktop). Mobile: tabs.
4. **Link.** Type `[[Other page]]` → a live suggestion menu lists existing pages whose title contains the input; arrow keys to pick, `Enter` to insert.
5. **Browse.** Tree on the far left (desktop) or under a hamburger (mobile). Click a node → opens it. Drag-reorder siblings updates `order_key`.
6. **Backlinks.** Below the body, a "Linked from" section lists notes that contain `[[Title]]`. Click → opens that note.
7. **Search.** Notes bodies feed the same `core` + Tantivy content index as documents (`12-search-surface.md`), so global search finds a note by its text; `Cmd-K` also has a "Search notes" mode.
8. **Trash.** Right-click or kebab → Trash (a tombstone, obeying retention/legal-hold like documents). Restore from Notes > Trash.
9. **Graduate.** Kebab → "Save to documents" exports the note as an `.md` document into the current project, starting a hash-chained version history for it.

## Surface

```
┌─ Sidebar  ─────────┐┌─ Tree (desktop) ─────────┐┌─ Editor ───────────────────────────┐
│  [E] Engineering ▾ ││  ＋ New page              ││ # Sprint planning                  │
│                    ││                            ││ Date: 2026-07-06                   │
│  ◇ Documents       ││  📄 Onboarding             ││                                    │
│  ✦ Notes           ││  📄 Sprint planning ●      ││ Discussed [[Q3 roadmap]] and the   │
│  ⭐ Starred         ││    └ 📄 Decisions          ││ migration timeline. Owners:        │
│  ⏱ Recent          ││  📄 Q3 roadmap             ││ - Alex                             │
│  …                 ││  📄 Postmortem template    ││ - Sam                              │
│                    ││  ── Trash                  ││ - …                                │
│                    ││                            ││                                    │
│                    ││                            ││ ── Linked from ──                  │
│                    ││                            ││ 📄 Q3 kickoff                      │
│                    ││                            ││ 📄 Weekly sync                     │
│                    ││                            ││                                    │
│                    ││                            ││ Saved 2 sec ago                    │
└────────────────────┘└────────────────────────────┘└────────────────────────────────────┘
```

- The tree column is sticky 240 px on viewports ≥ 1024; hidden under a `<details>` drawer below.
- The editor/preview split is 50/50 on desktop; mobile shows one at a time with a Tabs control at the top of the right pane.
- The kebab on each tree row exposes: Rename · Add child page · Move to · Trash.

## States

- **Empty project.** "No notes yet. Notes are great for meeting minutes, runbooks, decision logs — quick text that doesn't need a full version chain. Graduate one to a tracked `.md` document any time. **Write your first note**."
- **Loading tree.** Skeleton column with 6 rows pulsing.
- **Loading a note.** Title + body skeletons inside the editor pane.
- **Saving.** Tiny gray "Saving…" microstate in the editor footer; the body is sealed under the project DEK before it reaches storage.
- **Saved.** "Saved 2 sec ago" — relative time, updates every 30 s.
- **Conflict (last-write-wins).** Toast: "Someone else saved this note 4 s ago. Your changes overwrote theirs." (No real-time collab for notes in v0; the audit log records both saves so nothing is silently lost.)
- **Dangling link.** `[[Foo bar]]` renders red-underlined; click → "Create page 'Foo bar'" prompt.

## Mobile surface (< 1024 px)

```
┌─ Top bar ───────────────────────────────────────┐
│  [Logo] Notes      [Tree ▾]    [Search 🔍]      │
└─────────────────────────────────────────────────┘
            ↓ tap "Tree"
┌─ Drawer (vaul) ─────────────────────────────────┐
│  ＋ New page                                     │
│  📄 Onboarding                                   │
│  📄 Sprint planning ●                            │
│    └ Decisions                                   │
│  📄 Q3 roadmap                                   │
└─────────────────────────────────────────────────┘

┌─ Editor pane ───────────────────────────────────┐
│  [ Write | Preview ]                            │   ← tabs
│  ─────                                          │
│  # Sprint planning                              │
│  ...                                            │
└─────────────────────────────────────────────────┘
```

## Polish bar checklist

1. **One primary action per screen** — "+ New page" is the only filled button on the tree.
2. **Type carries hierarchy** — title 2xl, body md, tree sm, backlinks header xs caps.
3. **Snap to 4/8 grid** — same spacing as the rest of the hub.
4. **Concentric corners** — editor card matches inner code-block corners.
5. **Sub-100 ms** — keystrokes never lag (debounced save runs off-thread).
6. **Skeletons not spinners** — tree + editor have skeletons.
7. **Keyboard first** — `Cmd-N` new page, `Cmd-S` force-save, `Cmd-K` search, `Esc` close drawer, `Cmd-Enter` toggle preview, `Tab` indent.
8. **`prefers-reduced-motion`** — drawer slide gated, no fade-in for tree rows.
9. **One icon family** — Lucide.
10. **Copy is warm + direct** — placeholder "Title…" not "Untitled note (click to edit)".

## Permissions

Maps to the project roles in `13-workspaces-surface.md`:

| Role | View tree | Open note | Create | Edit | Move / Trash |
|---|---|---|---|---|---|
| Owner / Admin / Editor | yes | yes | yes | yes | yes |
| Viewer | yes | yes | no | no | no |
| Non-member | 403 across the board | — | — | — | — |
| Personal locker | only the owner (it's their locker) | — | — | — | — |

## Backend integration

- Server caps note body at 1 MiB. Larger → 413. UI shows a warning when 80% full.
- Title required 1–200 chars; trim + collapse whitespace.
- Title uniqueness is **not** enforced; multiple notes can share a title and link disambiguation prefers most-recently-modified.
- `parent_id` must be in the same project; the handler refuses cross-project nesting with 422.
- Note bodies are encrypted at rest under the project DEK and indexed for content search on save; a tombstoned note is removed from the index.

## Out of scope (later)

- Comments / replies.
- Per-note share-links (notes export as `.md` documents, which then use the document share-link path).
- Templates / page duplication.
- Real-time collab (documents get co-editing first; see `10-sdk-integration-plan.md`).
- Tags + tag pages.
- Move between projects.
- Hash-chained note history — notes stay last-write-wins by design; graduate to an `.md` document for a version chain.
