# 16 — Notes surface

Companion to `docs/research/09-notes-wiki.md`. The Notes app inside Drive — new left-rail surface beside My Drive, workspace-scoped, markdown.

## Flow

1. **Land.** User clicks "Notes" in the sidebar. Empty state if the workspace has no notes yet → primary CTA "Write your first note".
2. **Create.** Click "+ New page" (or `Cmd-N`). A new untitled note slides in, title focused. Hit `Enter` → focus moves to body.
3. **Write.** Plain markdown in the left pane, rendered preview in the right (desktop). Mobile: tabs.
4. **Link.** Type `[[Other page]]` → a live suggestion menu lists existing pages whose title contains the input; arrow keys to pick, `Enter` to insert.
5. **Browse.** Tree on the far left (desktop) or under a hamburger (mobile). Click a node → opens it. Drag-reorder siblings updates `order_key`.
6. **Backlinks.** Below the body, a "Linked from" section lists notes that contain `[[Title]]`. Click → opens that note. Clear how connected things are.
7. **Search.** `Cmd-K` (global palette) gets a "Search notes" mode; or the dedicated Notes top-bar search field.
8. **Trash.** Right-click or kebab → Trash. Restore from Notes > Trash (same pattern as files).

## Surface

```
┌─ Sidebar  ─────────┐┌─ Tree (desktop) ─────────┐┌─ Editor ───────────────────────────┐
│  [W] Engineering ▾ ││  ＋ New page              ││ # Sprint planning                  │
│                    ││                            ││ Date: 2026-06-08                   │
│  ◇ My Drive        ││  📄 Onboarding             ││                                    │
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

- **Empty workspace.** "No notes yet. Notes are great for meeting minutes, READMEs, runbooks — anything text you'd rather not stash in a `.md` file. **Write your first note**."
- **Loading tree.** Skeleton column with 6 rows pulsing.
- **Loading a note.** Title + body skeletons inside the editor pane.
- **Saving.** Tiny gray "Saving…" microstate in the editor footer.
- **Saved.** "Saved 2 sec ago" — relative time, updates every 30 s.
- **Conflict (last-write-wins).** Toast: "Someone else saved this note 4 s ago. Your changes overwrote theirs." (No real-time collab in v0.)
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
3. **Snap to 4/8 grid** — same spacing as Drive.
4. **Concentric corners** — editor card matches inner code-block corners.
5. **Sub-100 ms** — keystrokes never lag (debounced save runs off-thread).
6. **Skeletons not spinners** — tree + editor have skeletons.
7. **Keyboard first** — `Cmd-N` new page, `Cmd-S` force-save, `Cmd-K` search, `Esc` close drawer, `Cmd-Enter` toggle preview, `Tab` indent.
8. **`prefers-reduced-motion`** — drawer slide gated, no fade-in for tree rows.
9. **One icon family** — Lucide.
10. **Copy is warm + direct** — placeholder "Title…" not "Untitled note (click to edit)".

## Permissions

| Role | View tree | Open note | Create | Edit | Move / Trash |
|---|---|---|---|---|---|
| Workspace member | yes | yes | yes | yes | yes |
| Non-member | 403 across the board | — | — | — | — |
| Personal workspace | only the owner (it's their workspace) | — | — | — | — |

No view-only role in v0; that lands with the wider RBAC pass (§8.5).

## Backend integration

- Server caps note body at 1 MiB. Larger → 413. UI shows a warning when 80% full.
- Title required 1–200 chars; trim + collapse whitespace.
- Title uniqueness is **not** enforced; multiple notes can share a title and link disambiguation prefers most-recently-modified.
- `parent_id` must be in the same workspace; the handler refuses cross-workspace nesting with 422.

## Out of scope (v0.2+)

- Comments / replies.
- Per-note share-links (notes export as static HTML in a follow-up).
- Templates / page duplication.
- Real-time collab.
- Tags + tag pages.
- Move between workspaces.
- Cmd-K hooked up to notes (we list it on the spec but defer wiring to the Notes-in-palette item).
