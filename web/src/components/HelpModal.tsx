/**
 * Keyboard-shortcut cheat-sheet. Spec: docs/ux/10-bell-and-help.md.
 *
 * Sourced from a single SHORTCUTS array so adding a binding touches
 * one place. Trigger: button in TopBar, or the `?` keypress (wired in
 * the parent — App-level keydown handler).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface Shortcut {
  chord: string;
  description: string;
}

interface Group {
  title: string;
  rows: Shortcut[];
}

const SHORTCUTS: Group[] = [
  {
    title: "Navigation",
    rows: [
      { chord: "Backspace", description: "Go back" },
      { chord: "⌘ K", description: "Open command palette" },
      { chord: "Esc", description: "Clear selection / close modal" },
    ],
  },
  {
    title: "Selection",
    rows: [
      { chord: "Click", description: "Open the item" },
      { chord: "⌘ Click", description: "Toggle in current selection" },
      { chord: "Shift Click", description: "Range-select from the last anchor" },
      { chord: "⌘ A", description: "Select every visible item" },
    ],
  },
  {
    title: "Files",
    rows: [
      { chord: "↵", description: "Open" },
      { chord: "Space", description: "Preview" },
      { chord: "F2", description: "Rename" },
      { chord: "⌫", description: "Move to trash" },
    ],
  },
  {
    title: "Layout",
    rows: [
      { chord: "/", description: "Focus search" },
      { chord: "?", description: "Show this cheat sheet" },
    ],
  },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--bg-overlay)",
            zIndex: 90,
            animation: "cd-fade-in 200ms var(--ease)",
          }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(520px, 92vw)",
            maxHeight: "80vh",
            overflow: "auto",
            background: "var(--bg-surface)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "22px 24px 24px",
            boxShadow: "var(--shadow-lg)",
            zIndex: 91,
            animation: "cd-modal-in 240ms var(--ease)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Dialog.Title
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-xl)",
                fontWeight: 500,
                letterSpacing: "var(--tracking-tight)",
                color: "var(--ink)",
              }}
            >
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" style={iconBtn()}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description
            style={{
              margin: "4px 0 18px",
              fontSize: "var(--text-sm)",
              color: "var(--muted)",
            }}
          >
            Faster than reaching for the menu.
          </Dialog.Description>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {SHORTCUTS.map((g) => (
              <Section key={g.title} group={g} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      <style>
        {`
          @keyframes cd-fade-in   { from { opacity: 0; } to { opacity: 1; } }
          @keyframes cd-modal-in {
            from { opacity: 0; transform: translate(-50%, calc(-50% + 14px)) scale(.98); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}
      </style>
    </Dialog.Root>
  );
}

function Section({ group }: { group: Group }) {
  return (
    <section>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "2.5px",
          textTransform: "uppercase",
          color: "var(--muted-2)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {group.title}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {group.rows.map((r) => (
          <li
            key={r.chord}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              alignItems: "center",
              padding: "7px 0",
              gap: 16,
            }}
          >
            <Kbd>{r.chord}</Kbd>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>{r.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontSize: 11,
        background: "var(--bg-subtle)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        padding: "2px 8px",
        color: "var(--ink)",
        justifySelf: "start",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--muted)",
    padding: 6,
    borderRadius: 8,
  };
}
