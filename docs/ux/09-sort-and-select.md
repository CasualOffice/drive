# 09 — Sort + multi-select

Companion to `02-surface.md`. Covers the hub document-list header sort menu and the multi-select / selection-bar surface. Documents-only: every entry is a folder or an allowlisted document (`docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml`). No images, video, or thumbnails.

## Pattern reference

**Linear / Things 3 / Finder** converge on two primitives, and a document registry needs both:

1. A compact **sort dropdown** in the header — single key with an asc/desc toggle. Folders pinned above documents within whichever key is active.
2. **Cmd/Ctrl-click + Shift-click** to add or extend a selection, with a docked **selection bar** showing count + bulk actions.

We pick the same shape because both are universal (no learning curve) and compose cleanly with the existing right-click context menu without competing for the same affordance.

## Sort dropdown

```
┌─ Document-list header ──────────────────────────────────────────────────┐
│  Engineering · 12 documents                 [search]   [list]           │
│                                                                          │
│  Folders first  •  Name ▲     [ ⇅ Sort ▾ ]                              │
└──────────────────────────────────────────────────────────────────────────┘
```

- Trigger: a small ghost button labelled `↕ Sort` next to the view toggle.
- Body: a Radix DropdownMenu with two sub-groups —
  - **Sort by**: `Name` / `Modified` / `Size` / `Versions`
  - **Direction**: `Ascending` / `Descending`
- Default: `Name` + `Ascending`.
- **Versions** sorts by the document's version count (chain length) — surfaces the most-edited records, which is a registry-native axis Drive clones don't have.
- Folders are always rendered before documents within whichever sort is active. Sort by Modified shows folders by their modified time first, then documents. By Size or Versions, folders sort by name (we don't recursively size or count them in v0).
- Persistence: `dochub-sort-key-v1` in `localStorage`. Survives reload + sign-out.
- Keyboard: nothing in v0. ⌘1 / ⌘2 cycling lands when we have time for shortcuts.

## Multi-select

### Modifiers (Mac names; Windows/Linux substitutes Ctrl)

| Input | Behaviour |
|---|---|
| Click a row | Single-select that document/folder (clears previous selection if any). |
| ⌘-click | Toggle that item in the current selection. |
| Shift-click | Range-select: every item from the last clicked anchor to this one, inclusive. |
| ⌘-A | Select every visible entry (folders + documents). |
| Esc | Clear selection. |
| Right-click on an *unselected* item | Selects only that item, then opens the context menu (preserves the single-item flow). |
| Right-click on a *selected* item | Opens the context menu against the **whole** selection. v0 wires bulk-export + bulk-move + bulk-tombstone here. |

### Selection bar

Docked **at the bottom** of the document pane, slides up with the same 200 ms motion as toasts. Anchored to the viewport (not the scroll body) so it stays visible while the user scrolls a long list.

```
┌─ Bottom of the document pane ───────────────────────────────────────┐
│   3 selected    [ Clear ]           [ ↓ Export ]   [ ⤓ Move ]      │
│                                     [ 🗑 Move to trash ]            │
└──────────────────────────────────────────────────────────────────────┘
```

(Lucide SVGs in the real UI; emoji here for layout only.)

- Count chip on the left is informational.
- **Clear** is the "I'm done" affordance for non-keyboard users.
- Primary actions, ordered safest → most consequential:
  1. **Export** — streams each selected document's current version, decrypted server-side, as a zip. This is a *read* of the head version; it never mutates the chain. Backend bulk-export endpoint lands with the search work; v0 fires parallel per-document exports client-side.
  2. **Move** — reparent within the same project. Cross-project move is deferred (needs re-scoping the version chain and re-keying under the target workspace DEK).
  3. **Move to trash** — a **tombstone**, never a hard delete. Confirms inline if >5 items: `"Move 7 documents to trash?"` plus a destructive-styled button; ≤5 go direct. Tombstoning a document under **legal hold** or blocked by a **retention policy** is refused server-side; the bar surfaces the per-item refusal as a partial-failure toast (`"2 held documents kept"`) and leaves those rows selected. Bytes and versions are retained regardless.
- The bar disappears (translate-Y + opacity, 180 ms) when selection drops to zero.

### Visual selection state

- Selected row: full-row `--bg-selected` background + a left-edge `--accent` stripe (2 px wide).
- Hover-over-selected: row darkens slightly; stripe grows to 3 px.
- A tombstoned (in-trash) row selected for restore shows the same treatment with a muted `--muted` label.

## State checklist

| | Sort menu | Selection |
|---|---|---|
| Default | Name ▲ | empty |
| Loading | menu trigger disabled while listing | n/a |
| Empty (zero documents) | menu trigger hidden | n/a |
| Active | persisted | count chip ≥ 1 |
| Error | menu still usable (errors live on the list, not the controls) | bulk action shows toast on partial failure |
| Held item in selection | n/a | tombstone refused per-item; toast names the held count |

## Out of scope (v0)

- Drag-rectangle selection (lasso) — later polish.
- Keyboard arrow-key navigation between rows — paired with the focus model.
- Server-side bulk endpoints (`/api/documents/bulk-trash`, `/api/documents/bulk-export`) — land with search.
- Multi-select across folder navigation — selection clears on folder change in v0.
- Cross-project bulk move — needs version-chain re-scoping + re-keying (deferred).
