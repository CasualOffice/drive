/**
 * Cmd-K command palette. Pipeline §2.8.
 *
 * One keyboard surface for: navigation (jump to My Drive / Notes / Settings / …),
 * file search (`/api/search?q=`), and note search (`/api/notes/search?q=`).
 *
 * Open with `⌘K` / `Ctrl-K` from anywhere; closes on `Esc`. Results are
 * grouped (Go to · Folders · Files · Notes), arrow-key navigable, enter
 * activates. Mounted once at the Shell level so it survives tab switches.
 */
import { useCallback, useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  Activity as ActivityIcon,
  FileText,
  Folder,
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
import { EmptyState } from "./EmptyState.tsx";
import { Kbd } from "./ds/Kbd.tsx";
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

  const navResults = NAV_ACTIONS.filter((a) => navMatches(a, query));
  const showEmpty =
    query.trim().length >= 2 &&
    !loading &&
    folders.length === 0 &&
    files.length === 0 &&
    notes.length === 0 &&
    navResults.length === 0;

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
        <style>{`
          [cmdk-group-heading] {
            font-size: var(--text-2xs);
            line-height: 1;
            font-weight: var(--weight-semibold);
            letter-spacing: var(--tracking-wider);
            text-transform: uppercase;
            color: var(--fg-subtle);
            padding: 6px 10px 4px;
          }
          [cmdk-item][data-selected="true"] {
            background: var(--bg-selected);
            color: var(--fg-default);
          }
          [cmdk-item]:hover { background: var(--bg-hover); }
        `}</style>
        <Command label="Command palette" loop shouldFilter={false} filter={itemFilter}>
          <div style={inputRowStyle()}>
            <Search size={16} strokeWidth={1.5} style={{ color: "var(--fg-subtle)" }} />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search documents, notes, or jump to anywhere…"
              style={inputStyle()}
            />
            <Kbd>⌘K</Kbd>
          </div>

          <Command.List style={listStyle()}>
            {showEmpty ? (
              <div style={{ padding: "8px 0 20px" }}>
                <EmptyState
                  title={`No matches for "${query.trim()}"`}
                  body="Search covers document names, notes, and destinations."
                  illustration="file-search"
                />
              </div>
            ) : (
              <Command.Empty style={emptyStyle()}>
                {query.trim().length < 2
                  ? "Type to search documents + notes, or pick a destination."
                  : loading
                    ? "Searching…"
                    : "No matches."}
              </Command.Empty>
            )}

            {/* Navigation — always visible so Cmd-K → click to jump works
                even before typing. */}
            <Command.Group heading="Go to" style={groupStyle()}>
              {navResults.map((a) => {
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
                    <span style={iconBoxStyle()}>
                      <Icon size={14} strokeWidth={1.5} />
                    </span>
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
                <span style={iconBoxStyle()}>
                  <HelpCircle size={14} strokeWidth={1.5} />
                </span>
                <span style={{ flex: 1 }}>Keyboard shortcuts</span>
                <Kbd>?</Kbd>
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
                    <span style={iconBoxStyle()}>
                      <Folder size={14} strokeWidth={1.5} />
                    </span>
                    <span style={{ flex: 1 }}>{f.name}</span>
                    <span style={hintStyle()}>Folder</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {files.length > 0 && (
              <Command.Group heading="Documents" style={groupStyle()}>
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
                    <span style={iconBoxStyle()}>
                      <FileText size={14} strokeWidth={1.5} />
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </span>
                    <span className="mono" style={hintStyle()}>
                      {formatBytes(f.size)}
                    </span>
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
                    <span style={iconBoxStyle()}>
                      <NotebookPen size={14} strokeWidth={1.5} />
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
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
            </span>
            <span>
              <Kbd>↵</Kbd> select
            </span>
            <span>
              <Kbd>Esc</Kbd> close
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

// ── styles ───────────────────────────────────────────────────────────

function overlayStyle(): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
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
    maxWidth: 560,
    background: "var(--bg-raised)",
    border: "1px solid var(--border-hair)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-md)",
    overflow: "hidden",
    fontFamily: "var(--font-sans)",
    color: "var(--fg-default)",
    margin: "0 16px",
    animation: "cd-cmd-pop 180ms var(--ease)",
  };
}

function inputRowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border-hair)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    flex: 1,
    border: 0,
    background: "transparent",
    outline: "none",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md)",
    color: "var(--fg-default)",
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
    color: "var(--fg-muted)",
    textAlign: "center" as const,
  };
}

function groupStyle(): React.CSSProperties {
  return {
    padding: "4px 0",
  };
}

function itemStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: "var(--text-base)",
    color: "var(--fg-default)",
    cursor: "pointer",
    userSelect: "none",
  };
}

function iconBoxStyle(): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: "var(--radius-xs)",
    background: "var(--bg-sunken)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--fg-muted)",
    flexShrink: 0,
  };
}

function hintStyle(): React.CSSProperties {
  return {
    fontSize: "var(--text-xs)",
    color: "var(--fg-subtle)",
    fontVariantNumeric: "tabular-nums",
  };
}

function footerStyle(): React.CSSProperties {
  return {
    display: "flex",
    gap: 14,
    padding: "8px 12px",
    borderTop: "1px solid var(--border-hair)",
    fontSize: "var(--text-xs)",
    color: "var(--fg-muted)",
    background: "var(--bg-sunken)",
  };
}
