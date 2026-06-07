# 10 — Notifications bell + help shortcuts

Companion to `02-surface-v2.md` §"Top bar". Closes pipeline items §2.9 and §2.10. Both are P2 polish — the bell shows recent recipient activity, the help modal exposes the keyboard cheat-sheet.

## Bell

```
[ Search ……………… ]  [Grid|List]  [↕ Sort]  [ 🔔² ]  [ ? ]
```

- Lucide `Bell` icon, 17 px, `--muted` default colour.
- Tiny count badge in the top-right corner when there's at least one unseen entry. Pill — `--accent` background, `--paper` text, 16 px wide max.
- Click → Radix DropdownMenu (right-aligned, 320 px wide).
- Header row: "Notifications" + a `Mark all as read` link (no-op when empty).
- Body: latest 10 events of interest. v0 reads from `/api/activity?limit=20` and filters to the actions that meaningfully affect *the operator* —
  - `share.access` ("someone opened *Q2 planning.xlsx*")
  - `auth.sign_in_failed` ("sign-in failed for *username*")
- Footer: "View all activity →" linking to the `/activity` surface.
- Empty state: "Nothing new." centred in `--muted`.
- Unseen state persisted in `localStorage` (`cd-notif-seen-v1`) by `created_at` cursor. Opening the dropdown marks every visible entry as seen and clears the badge.

Server-side push (SSE / WebSocket) is v0.2 — for now the dropdown re-fetches each time it opens, plus on a 60-second poll while the tab is foregrounded.

## Help modal

- Trigger: Lucide `HelpCircle` icon next to the bell, or the `?` key (when not typing).
- Esc closes (Radix Dialog default).
- Radix Dialog. 520 px wide, sectioned cheat-sheet.

```
┌─ Keyboard shortcuts ──────────────────────────────────┐
│                                              [×]      │
│                                                       │
│  ┌─ Navigation ─────────────────────────────────────┐ │
│  │  Backspace        Go back                        │ │
│  │  ⌘ K              Open command palette           │ │
│  │  Esc              Clear selection                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ Selection ──────────────────────────────────────┐ │
│  │  Click            Open                           │ │
│  │  ⌘ Click          Toggle in selection            │ │
│  │  Shift Click      Range select                   │ │
│  │  ⌘ A              Select all                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ Files ──────────────────────────────────────────┐ │
│  │  ↵                Open                           │ │
│  │  Space            Preview                        │ │
│  │  F2               Rename                         │ │
│  │  ⌫                Move to trash                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ Layout ─────────────────────────────────────────┐ │
│  │  /                Focus search                   │ │
│  │  ?                Show shortcuts (this modal)    │ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

Implementation notes:

- The chord chips use the same `kbd` style as elsewhere — monospace, 11 px, `--bg-subtle` background, `--line` border, 5 px radius, 1 px / 6 px padding.
- Each row is a two-column grid: chord on the left, plain-language description on the right. No truncation needed at 520 px.
- Mac symbols rendered literally (⌘, ⌥, ⇧, ⌫, ↵). The chord chips don't try to disambiguate Mac vs Windows — the few shortcuts that differ in modifier (e.g. ⌘ vs Ctrl) are listed as `⌘ A` on every platform; this matches Linear / Notion / Figma's pragmatic shortcut prose.
- Sourced from a single `SHORTCUTS` array in the component so adding a binding only touches one place.

## Out of scope (v0)

- Real-time notifications (SSE / WebSocket) — v0.2.
- Push notifications (browser, mobile) — v0.2.
- Email digest — v0.2 (lives alongside §9.8 Settings → Notifications).
- Customisable shortcuts — Phase 2.
