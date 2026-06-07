/**
 * Cmd-K command palette. Pipeline §2.8.
 *
 * One keyboard surface for: navigation (jump to My Drive / Notes / Settings / …),
 * file search (`/api/search?q=`), and note search (`/api/notes/search?q=`).
 *
 * Open with `⌘K` / `Ctrl-K` from anywhere; closes on `Esc`. Results are
 * grouped (Go to · Files · Notes), arrow-key navigable, enter activates.
 * Mounted once at the Shell level so it survives tab switches.
 */
import { useCallback, useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  Activity as ActivityIcon,
  FileText,
  Gauge,
  HelpCircle,
  Home,
  NotebookPen,
  Search,
  Settings as SettingsIcon,
  Share2,
  Star,
  Trash2,
} from "lucide-react";

import {
  type FileDto,
  type FolderDto,
  type NoteNode,
  notesSearch,
  searchAll,
} from "../api/client.ts";
import { useActiveWorkspaceId } from "../state/WorkspaceContext.tsx";
import type { NavId } from "./Sidebar.tsx";

type NavAction = {
  id: NavId;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  hint?: string;
};

const NAV_ACTIONS: NavAction[] = [
  { id: "home", label: "My Drive", icon: Home, hint: "Files + folders" },
  { id: "notes", label: "Notes", icon: NotebookPen, hint: "Pages + wiki" },
  { id: "recent", label: "Recent", icon: Star, hint: "Recently opened" },
  { id: "starred", label: "Starred", icon: Star, hint: "Pinned items" },
  { id: "shared", label: "Shared", icon: Share2, hint: "Shared with you" },
  { id: "activity", label: "Activity", icon: ActivityIcon, hint: "Audit feed" },
  { id: "admin", label: "Admin", icon: Gauge, hint: "System + users" },
  { id: "trash", label: "Trash", icon: Trash2, hint: "Deleted items" },
  { id: "settings", label: "Settings", icon: SettingsIcon, hint: "Account + storage" },
];

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onOpenFile,
  onOpenNote,
  onShowHelp,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onNavigate: (id: NavId) => void;
  onOpenFile: (file: FileDto) => void;
  onOpenNote: (id: string) => void;
  onShowHelp: () => void;
}) {
  const workspaceId = useActiveWorkspaceId();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [notes, setNotes] = useState<NoteNode[]>([]);
  const [loading, setLoading] = useState(false);

  // Global keyboard trigger. `Cmd-K` / `Ctrl-K` from anywhere outside an
  // editable element opens the palette; if it's already open, the cmdk
  // root handles Esc + arrows + Enter.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Reset query whenever the palette is dismissed.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setFiles([]);
      setFolders([]);
      setNotes([]);
    }
  }, [open]);

  // Debounced search across files + notes. Abort on each keystroke.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setFiles([]);
      setFolders([]);
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const [fileRes, noteRes] = await Promise.allSettled([
          searchAll(q, controller.signal, workspaceId),
          notesSearch(q, workspaceId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (fileRes.status === "fulfilled") {
          setFiles(fileRes.value.files.slice(0, 8));
          setFolders(fileRes.value.folders.slice(0, 6));
        }
        if (noteRes.status === "fulfilled") {
          setNotes(noteRes.value.slice(0, 8));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [open, query, workspaceId]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // cmdk groups items by their `value` for matching; we want the input
  // to be the source of truth, so disable the built-in filter.
  const itemFilter = useCallback(() => 1, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={overlayStyle()}
    >
      <div style={panelStyle()}>
        <Command label="Command palette" loop shouldFilter={false} filter={itemFilter}>
          <div style={inputRowStyle()}>
            <Search size={16} strokeWidth={2} style={{ color: "var(--muted)" }} />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search files, notes, or jump to anywhere…"
              style={inputStyle()}
            />
            <kbd style={kbdStyle()}>Esc</kbd>
          </div>

          <Command.List style={listStyle()}>
            <Command.Empty style={emptyStyle()}>
              {query.trim().length < 2
                ? "Type to search files + notes, or pick a destination."
                : loading
                  ? "Searching…"
                  : "No matches."}
            </Command.Empty>

            {/* Navigation — always visible so Cmd-K → click to jump works
                even before typing. */}
            <Command.Group heading="Go to" style={groupStyle()}>
              {NAV_ACTIONS.filter((a) =>
                navMatches(a, query),
              ).map((a) => {
                const Icon = a.icon;
                return (
                  <Command.Item
                    key={`nav:${a.id}`}
                    value={`nav:${a.id}`}
                    onSelect={() => {
                      onNavigate(a.id);
                      close();
                    }}
                    style={itemStyle()}
                  >
                    <Icon size={15} strokeWidth={1.7} />
                    <span style={{ flex: 1 }}>{a.label}</span>
                    {a.hint && <span style={hintStyle()}>{a.hint}</span>}
                  </Command.Item>
                );
              })}

              <Command.Item
                value="action:help"
                onSelect={() => {
                  onShowHelp();
                  close();
                }}
                style={itemStyle()}
              >
                <HelpCircle size={15} strokeWidth={1.7} />
                <span style={{ flex: 1 }}>Keyboard shortcuts</span>
                <kbd style={kbdStyle()}>?</kbd>
              </Command.Item>
            </Command.Group>

            {folders.length > 0 && (
              <Command.Group heading="Folders" style={groupStyle()}>
                {folders.map((f) => (
                  <Command.Item
                    key={`folder:${f.id}`}
                    value={`folder:${f.id}`}
                    onSelect={() => {
                      // No folder-open shortcut yet — route to My Drive
                      // and let the user click in. Future: deep-link.
                      onNavigate("home");
                      close();
                    }}
                    style={itemStyle()}
                  >
                    <span style={iconBoxStyle("rgba(200,164,92,0.18)")}>
                      <FileText size={14} strokeWidth={1.6} />
                    </span>
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <span style={hintStyle()}>Folder</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {files.length > 0 && (
              <Command.Group heading="Files" style={groupStyle()}>
                {files.map((f) => (
                  <Command.Item
                    key={`file:${f.id}`}
                    value={`file:${f.id}`}
                    onSelect={() => {
                      onOpenFile(f);
                      close();
                    }}
                    style={itemStyle()}
                  >
                    <span style={iconBoxStyle("rgba(26,26,30,0.06)")}>
                      <FileText size={14} strokeWidth={1.6} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </span>
                    <span style={hintStyle()}>{formatBytes(f.size)}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {notes.length > 0 && (
              <Command.Group heading="Notes" style={groupStyle()}>
                {notes.map((n) => (
                  <Command.Item
                    key={`note:${n.id}`}
                    value={`note:${n.id}`}
                    onSelect={() => {
                      onOpenNote(n.id);
                      close();
                    }}
                    style={itemStyle()}
                  >
                    <span style={iconBoxStyle("rgba(47,125,63,0.16)")}>
                      <NotebookPen size={14} strokeWidth={1.6} />
                    </span>
                    <span style={{ flex: 1 }}>{n.title}</span>
                    <span style={hintStyle()}>Note</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>

          <div style={footerStyle()}>
            <span>
              <kbd style={kbdStyle()}>↑</kbd> <kbd style={kbdStyle()}>↓</kbd>{" "}
              navigate
            </span>
            <span>
              <kbd style={kbdStyle()}>↵</kbd> select
            </span>
            <span>
              <kbd style={kbdStyle()}>⌘K</kbd> toggle
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function navMatches(a: NavAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    a.label.toLowerCase().includes(q) ||
    (a.hint?.toLowerCase().includes(q) ?? false) ||
    a.id.includes(q)
  );
}

function formatBytes(b: number): string {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// ── styles (inline for now; tokens.css owns the colour palette) ─────

function overlayStyle(): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    background: "rgba(15,15,19,0.42)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "12vh",
    zIndex: 80,
    animation: "cd-cmd-overlay 160ms var(--ease)",
  };
}

function panelStyle(): React.CSSProperties {
  return {
    width: "100%",
    maxWidth: 640,
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    boxShadow: "0 22px 60px rgba(26,26,30,.28)",
    overflow: "hidden",
    fontFamily: "var(--font-sans)",
    color: "var(--ink)",
    margin: "0 16px",
    animation: "cd-cmd-pop 180ms var(--ease)",
  };
}

function inputRowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--line)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    flex: 1,
    border: 0,
    background: "transparent",
    outline: "none",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md, 1rem)",
    color: "var(--ink)",
    padding: "4px 0",
  };
}

function listStyle(): React.CSSProperties {
  return {
    maxHeight: "52vh",
    overflowY: "auto",
    padding: "6px 6px 8px",
  };
}

function emptyStyle(): React.CSSProperties {
  return {
    padding: "20px 14px",
    fontSize: "var(--text-sm)",
    color: "var(--muted)",
    textAlign: "center" as const,
  };
}

function groupStyle(): React.CSSProperties {
  return {
    padding: "6px 0",
  };
}

function itemStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: "var(--text-sm)",
    color: "var(--ink-soft)",
    cursor: "pointer",
    userSelect: "none",
  };
}

function iconBoxStyle(bg: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: bg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--ink-soft)",
    flexShrink: 0,
  };
}

function hintStyle(): React.CSSProperties {
  return {
    fontSize: "var(--text-xs)",
    color: "var(--muted-2)",
    fontVariantNumeric: "tabular-nums",
  };
}

function kbdStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    padding: "2px 6px",
    border: "1px solid var(--line-strong)",
    borderRadius: 4,
    color: "var(--muted)",
    background: "var(--bg-subtle)",
  };
}

function footerStyle(): React.CSSProperties {
  return {
    display: "flex",
    gap: 14,
    padding: "10px 14px",
    borderTop: "1px solid var(--line)",
    fontSize: "var(--text-xs)",
    color: "var(--muted)",
    background: "var(--paper-2, var(--bg-subtle))",
  };
}
