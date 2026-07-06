# 10 — Notifications bell + help shortcuts

Companion to `02-surface.md` §"Top bar". Both are polish items — the bell shows recent activity that matters to the operator (access, sign-in, and integrity events), the help modal exposes the keyboard cheat-sheet.

## Bell

```
[ Search ……………… ]  [List]  [↕ Sort]  [ 🔔² ]  [ ? ]
```

- Lucide `Bell` icon, 17 px, `--muted` default colour.
- Tiny count badge in the top-right corner when there's at least one unseen entry. Pill — `--accent` background, `--paper` text, 16 px wide max.
- Click → Radix DropdownMenu (right-aligned, 320 px wide).
- Header row: "Notifications" + a `Mark all as read` link (no-op when empty).
- Body: latest 10 events of interest, read from `/api/activity?limit=20` and filtered to the actions that meaningfully affect *the operator* —
  - `share.access` ("someone opened *Q2 planning.xlsx*")
  - `auth.sign_in_failed` ("sign-in failed for *username*")
  - `document.version_committed` ("*Alex* saved a new version of *Q3 roadmap.docx*")
  - `integrity.chain_break` ("verification failed on *contract.pdf* — review") — rendered in `--danger`, always sorted to the top, and never auto-marked seen (see below).
  - `legal_hold.applied` / `retention.tombstone_blocked` (compliance-relevant)
- Footer: "View all activity →" linking to the append-only audit surface.
- Empty state: "Nothing new." centred in `--muted`.
- Unseen state persisted in `localStorage` (`dochub-notif-seen-v1`) by `created_at` cursor. Opening the dropdown marks visible entries seen and clears the badge — **except** `integrity.chain_break`, which stays flagged until an admin acknowledges it on the version-history surface (`18-version-history-surface.md`). A tamper alarm is not dismissed by glancing at a dropdown.

Server-side push (SSE / WebSocket) is deferred — for now the dropdown re-fetches each time it opens, plus on a 60-second poll while the tab is foregrounded. Integrity events piggyback the same poll.

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
│  ┌─ Documents ──────────────────────────────────────┐ │
│  │  ↵                Open in editor                 │ │
│  │  H                Version history                │ │
│  │  F2               Rename                         │ │
│  │  ⌫                Move to trash (tombstone)      │ │
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
- Each row is a two-column grid: chord left, plain-language description right. No truncation at 520 px.
- No `Space` → preview binding: documents open into their editor, not a thumbnail overlay. `H` opens the version-history timeline for the focused document.
- Mac symbols rendered literally (⌘, ⌥, ⇧, ⌫, ↵). Chords that differ only by modifier (⌘ vs Ctrl) are listed as `⌘ A` on every platform — matches Linear / Notion / Figma's pragmatic shortcut prose.
- Sourced from a single `SHORTCUTS` array in the component so adding a binding only touches one place.

## Out of scope

- Real-time notifications (SSE / WebSocket).
- Push notifications (browser, mobile).
- Email digest — lives alongside Settings → Notifications.
- Customisable shortcuts.
