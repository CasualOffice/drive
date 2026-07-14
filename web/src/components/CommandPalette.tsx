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
  FileDown,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Gauge,
  Gavel,
  HelpCircle,
  Home,
  NotebookPen,
  PenLine,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

import {
  type ContentHit,
  type FileDto,
  type FolderDto,
  type NoteNode,
  notesSearch,
  searchAll,
  searchContent,
} from "../api/client.ts";
import { useActiveWorkspaceId } from "../state/WorkspaceContext.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { SearchSnippet } from "./SearchSnippet.tsx";
import { Kbd } from "./ds/Kbd.tsx";
import type { NavId } from "./Sidebar.tsx";

type NavAction = {
  id: NavId;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  hint?: string;
};

type CreateAction = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  kbd?: string;
  run: () => void;
};

// UI-M6 (gap 3): context-aware compliance/registry commands. Shown only
// when a document is the active context (the top document match). Every
// one lands on `/document/{id}/history` — the verify + provenance +
// legal-hold compliance surface — so none is a dead no-op.
type DocAction = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  kbd?: string;
  hint: string;
};

const DOC_ACTIONS: DocAction[] = [
  { key: "verify", label: "Verify chain", icon: ShieldCheck, kbd: "⌘⇧V", hint: "Recompute hash chain" },
  { key: "sign", label: "Sign", icon: PenLine, hint: "Provenance signature" },
  { key: "hold", label: "Place legal hold", icon: Gavel, hint: "Freeze from deletion" },
  { key: "provenance", label: "Export provenance bundle", icon: FileDown, hint: "Signed audit export" },
];

// UI-M6: coming-soon destinations (Recent / Starred / Shared) are filtered
// out of GO TO — only real, navigable surfaces appear.
const NAV_ACTIONS: NavAction[] = [
  { id: "home", label: "My Drive", icon: Home, hint: "Files + folders" },
  { id: "notes", label: "Notes", icon: NotebookPen, hint: "Pages + wiki" },
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
  onNewDocument,
  onNewFolder,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onNavigate: (id: NavId) => void;
  onOpenFile: (file: FileDto) => void;
  onOpenNote: (id: string) => void;
  onShowHelp: () => void;
  onNewDocument: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  const workspaceId = useActiveWorkspaceId();
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<FileDto[]>([]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [notes, setNotes] = useState<NoteNode[]>([]);
  // Phase 3 §2 — full-text hits inside document content (distinct from the
  // name/metadata matches in `files`). Shown as a separate "In documents"
  // group with a snippet + highlight beneath the name matches.
  const [content, setContent] = useState<ContentHit[]>([]);
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
      setContent([]);
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
      setContent([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const [fileRes, noteRes, contentRes] = await Promise.allSettled([
          searchAll(q, controller.signal, workspaceId),
          notesSearch(q, workspaceId, controller.signal),
          searchContent(q, { limit: 8, signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        // Name/metadata matches — the primary group. Track their ids so
        // content hits for the same document are de-duped out below.
        const nameIds = new Set<string>();
        if (fileRes.status === "fulfilled") {
          const nameFiles = fileRes.value.files.slice(0, 8);
          for (const f of nameFiles) nameIds.add(f.id);
          setFiles(nameFiles);
          setFolders(fileRes.value.folders.slice(0, 6));
        } else {
          setFiles([]);
          setFolders([]);
        }
        if (noteRes.status === "fulfilled") {
          setNotes(noteRes.value.slice(0, 8));
        } else {
          // Clear like files/content do — otherwise a note-search failure
          // leaves the previous query's notes rendered under the new query.
          setNotes([]);
        }
        // Content matches minus anything already shown as a name match.
        if (contentRes.status === "fulfilled") {
          setContent(contentRes.value.filter((h) => !nameIds.has(h.file_id)).slice(0, 8));
        } else {
          setContent([]);
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

  // UI-M6 (gap 3): route to a document's compliance surface. Seeds
  // history.state with the FileDto so VersionHistoryPage names it on the
  // hot path (falls back to a cold GET on deep-link), matching the
  // Files.tsx "Version history" navigation exactly.
  const openCompliance = useCallback(
    (file: FileDto) => {
      const url = `/document/${encodeURIComponent(file.id)}/history`;
      window.history.pushState({ file }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
      close();
    },
    [close],
  );

  // The active document context = the top document match. Its compliance
  // commands (Verify chain / Sign / Place hold / Export provenance) ride
  // in an ACTIONS group below.
  const activeDoc = files[0] ?? null;

  // ⌘⇧V — Verify chain accelerator. Live only while the palette is open
  // AND a document is the active context, so it's never a dead binding.
  useEffect(() => {
    if (!open || !activeDoc) return;
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.shiftKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        openCompliance(activeDoc!);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeDoc, openCompliance]);

  // cmdk groups items by their `value` for matching; we want the input
  // to be the source of truth, so disable the built-in filter.
  const itemFilter = useCallback(() => 1, []);

  if (!open) return null;

  const navResults = NAV_ACTIONS.filter((a) => navMatches(a, query));

  const CREATE_ACTIONS: CreateAction[] = [
    { key: "doc", label: "New document", icon: FilePlus, kbd: "⌘N", run: onNewDocument },
    { key: "folder", label: "New folder", icon: FolderPlus, kbd: "⌘⇧N", run: onNewFolder },
    { key: "upload", label: "Upload files", icon: Upload, run: onUpload },
  ];
  const createResults = CREATE_ACTIONS.filter((c) => createMatches(c, query));

  const showEmpty =
    query.trim().length >= 2 &&
    !loading &&
    folders.length === 0 &&
    files.length === 0 &&
    content.length === 0 &&
    notes.length === 0 &&
    navResults.length === 0 &&
    createResults.length === 0;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="cd-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={overlayStyle()}
    >
      <div className="cd-spotlight" style={panelStyle()}>
        <style>{`
          /* ── Spotlight surface — neobrutalist solid bordered modal (spec §5).
             Flat solid fill, 2px ink border, hard offset shadow, no blur, no
             glass. High contrast — never a pale translucent dropdown. */
          .cd-spotlight {
            background: var(--bg-surface);
            border: var(--border-w) solid var(--border);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-lg);
          }

          [cmdk-group-heading] {
            font-size: var(--text-2xs);
            line-height: 1;
            font-weight: var(--weight-semibold);
            letter-spacing: var(--tracking-wider);
            text-transform: uppercase;
            color: var(--fg-subtle);
            padding: 6px 10px 4px;
          }

          /* Active row — amber wash + a 2px amber left rule (verification as
             spatial identity, not a loud highlight). */
          [cmdk-item][data-selected="true"] {
            background: var(--bg-selected);
            color: var(--fg-default);
            box-shadow: inset 2px 0 0 0 var(--accent);
          }
          /* Leading icon chip — default well, then lights amber + glows on
             the active row (color/background live here, not inline, so the
             selection state can override them). */
          .cd-spotlight [cmdk-item] > span:first-child {
            background: var(--bg-sunken);
            color: var(--fg-muted);
          }
          [cmdk-item][data-selected="true"] > span:first-child {
            color: var(--accent);
            background: var(--amber-glow-2);
            box-shadow: var(--accent-glow);
          }
          [cmdk-item]:hover { background: var(--bg-hover); }

          @keyframes cd-cmd-overlay { from { opacity: 0; } to { opacity: 1; } }
          @keyframes cd-cmd-pop {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          @media (prefers-reduced-motion: reduce) {
            .cd-scrim, .cd-spotlight { animation: none !important; }
          }
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

            {/* Quick-create — the New menu, one keystroke away. Filtered by
                the same substring match so typing "upload" surfaces it. */}
            {createResults.length > 0 && (
              <Command.Group heading="Quick create" style={groupStyle()}>
                {createResults.map((c) => {
                  const Icon = c.icon;
                  return (
                    <Command.Item
                      key={`create:${c.key}`}
                      value={`create:${c.key}`}
                      onSelect={() => {
                        c.run();
                        close();
                      }}
                      style={itemStyle()}
                    >
                      <span style={iconBoxStyle()}>
                        <Icon size={14} strokeWidth={1.5} />
                      </span>
                      <span style={{ flex: 1 }}>{c.label}</span>
                      {c.kbd && <Kbd>{c.kbd}</Kbd>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

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

            {/* In documents — Phase 3 content matches (text found INSIDE a
                document), each with a highlighted snippet. Selecting opens
                the file, same as a name match. */}
            {content.length > 0 && (
              <Command.Group heading="In documents" style={groupStyle()}>
                {content.map((h) => (
                  <Command.Item
                    key={`content:${h.file_id}`}
                    value={`content:${h.file_id}`}
                    onSelect={() => {
                      // Content hits carry only id/title/kind; synthesize a
                      // minimal FileDto — Shell routes on `id`, and the
                      // Files handler hydrates full metadata on open.
                      onOpenFile({ id: h.file_id, name: h.title } as FileDto);
                      close();
                    }}
                    style={{ ...itemStyle(), alignItems: "flex-start" }}
                    data-testid="cmdk-content-hit"
                  >
                    <span style={iconBoxStyle()}>
                      <FileText size={14} strokeWidth={1.5} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h.title}
                      </span>
                      <SearchSnippet snippet={h.snippet} query={query} />
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Actions — compliance/registry commands for the active
                document (the top match). Keyboard-driven; every item
                lands on the verify + provenance surface. */}
            {activeDoc && (
              <Command.Group
                heading={`Actions · ${truncateName(activeDoc.name)}`}
                style={groupStyle()}
              >
                {DOC_ACTIONS.map((a) => {
                  const Icon = a.icon;
                  return (
                    <Command.Item
                      key={`docaction:${a.key}`}
                      value={`docaction:${a.key}`}
                      onSelect={() => openCompliance(activeDoc)}
                      style={itemStyle()}
                    >
                      <span style={iconBoxStyle()}>
                        <Icon size={14} strokeWidth={1.5} />
                      </span>
                      <span style={{ flex: 1 }}>{a.label}</span>
                      <span style={hintStyle()}>{a.hint}</span>
                      {a.kbd && <Kbd>{a.kbd}</Kbd>}
                    </Command.Item>
                  );
                })}
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

function createMatches(c: CreateAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return c.label.toLowerCase().includes(q) || c.key.includes(q);
}

function truncateName(name: string, max = 28): string {
  return name.length <= max ? name : `${name.slice(0, max - 1)}…`;
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

/** Scrim — a flat dimmed (not blurred) ink scrim behind the Spotlight
 * (spec §5: dimmed, not blurred). Quick fade so the palette feels instant. */
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
    animation: "cd-cmd-overlay 160ms var(--ease-out)",
  };
}

/** Spotlight panel — the `.cd-spotlight` class supplies the flat solid
 * fill, 2px ink border, radius, and hard offset shadow. Inline only
 * carries geometry + the spring entrance. */
function panelStyle(): React.CSSProperties {
  return {
    width: "100%",
    maxWidth: 600,
    overflow: "hidden",
    fontFamily: "var(--font-sans)",
    color: "var(--fg-default)",
    margin: "0 16px",
    animation: "cd-cmd-pop var(--dur-overlay) var(--ease-spring)",
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

// Geometry only — `background`/`color` are set in the injected <style> so
// the selected-row amber wash + glow can override them (inline would win).
function iconBoxStyle(): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: "var(--radius-xs)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
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
