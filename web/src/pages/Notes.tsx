/**
 * Notes / Wiki shell. Pipeline §8.11. Spec: docs/ux/16-notes-surface.md.
 *
 * Tree (sticky 240 px on desktop, drawer on mobile) + Editor (Phase 3 §17
 * live-render markdown via Tiptap) + Backlinks panel.
 *
 * The editor never exposes markdown source to the user — it parses
 * markdown in, renders blocks live as the user types, and serializes
 * markdown back out. Storage format unchanged. See
 * docs/research/17-notes-general-user-ux.md for the locked decisions.
 */
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight, NotebookPen, Plus, RotateCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { MarkdownEditor } from "../components/notes/MarkdownEditor.tsx";

import {
  type Note,
  type NoteNode,
  noteCreate,
  noteDelete,
  noteGet,
  notePatch,
  noteRestore,
  noteTrash,
  notesSearch,
  notesTree,
} from "../api/client.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { useActiveWorkspaceId } from "../state/WorkspaceContext.tsx";

const DRAFT_KEY_PREFIX = "cd-note-draft-v1:";

export function Notes({ initialNoteId }: { initialNoteId?: string | null } = {}) {
  const workspaceId = useActiveWorkspaceId();
  const [tree, setTree] = useState<NoteNode[]>([]);
  const [trashed, setTrashed] = useState<NoteNode[]>([]);
  // Seed from the deep-link note id so a `?note=<id>` open is deterministic —
  // it doesn't depend on the lazy chunk mounting before a timer fires.
  const [openId, setOpenId] = useState<string | null>(initialNoteId ?? null);
  const [open, setOpen] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  // Persistent tree-load error — distinct from the transient toast, so a failed
  // load isn't silently mistaken for an empty notebook (both would otherwise
  // render the "No notes yet" empty state).
  const [treeError, setTreeError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<NoteNode[]>([]);
  const [searching, setSearching] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  // Refresh tree when workspace changes.
  const refreshTree = useCallback(async () => {
    setLoading(true);
    try {
      const r = await notesTree(workspaceId);
      setTree(r.nodes);
      setTrashed(r.trashed);
      setTreeError(null);
      // If the currently-open note is gone, drop it.
      if (openId && !r.nodes.some((n) => n.id === openId)) {
        setOpenId(null);
        setOpen(null);
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "Couldn't load notes";
      setTreeError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, openId]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  // When workspace changes, drop the open note.
  const lastWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (lastWorkspaceRef.current === workspaceId) return;
    lastWorkspaceRef.current = workspaceId;
    setOpenId(null);
    setOpen(null);
  }, [workspaceId]);

  // Cmd-K palette → "open note" dispatches a CustomEvent we listen for.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (id) setOpenId(id);
    }
    window.addEventListener("cd:open-note", onOpen);
    return () => window.removeEventListener("cd:open-note", onOpen);
  }, []);

  // Open a note by id.
  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    (async () => {
      try {
        const n = await noteGet(openId);
        if (cancelled) return;
        setOpen(n);
        setSaveState("idle");
      } catch {
        if (!cancelled) toast.error("Couldn't load note");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId]);

  // Debounced server save. The textarea writes to `open.body` immediately
  // for snappiness; this effect schedules the PATCH 600 ms after the last
  // keystroke (or sooner on Cmd-S).
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => void persist(), 600);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.body, open?.title]);

  const persist = useCallback(async () => {
    if (!open) return;
    setSaveState("saving");
    try {
      // Snapshot what we're SENDING — used after the await to detect
      // whether the user typed more during the round-trip. Without this
      // guard, blindly `setOpen(updated)` would clobber any keystrokes
      // landed during the network turn (visible as "the title input
      // drops characters mid-typing" / "the editor briefly jumps back").
      const sentTitle = open.title;
      const sentBody = open.body;
      const updated = await notePatch(open.id, {
        title: sentTitle,
        body: sentBody,
      });
      // Only sync the server-owned fields (timestamps, version,
      // parent_id, etc.). KEEP local title + body — if they changed
      // during the round-trip, the next debounced save will catch up;
      // if they didn't, the local values still equal what we sent so
      // overwriting would be a no-op anyway.
      setOpen((prev) => {
        if (!prev || prev.id !== updated.id) return prev;
        return {
          ...updated,
          title: prev.title,
          body: prev.body,
        };
      });
      setSaveState("saved");
      setSavedAt(Date.now());
      try {
        window.localStorage.removeItem(DRAFT_KEY_PREFIX + open.id);
      } catch {
        /* ignored */
      }
      // Tree title might have changed; refresh the tree but DON'T close.
      const t = await notesTree(workspaceId);
      setTree(t.nodes);
      setTrashed(t.trashed);
    } catch (e: unknown) {
      setSaveState("error");
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "Save failed";
      toast.error(msg);
    }
  }, [open, workspaceId]);

  // Local-draft persistence — survives reload mid-edit.
  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(
        DRAFT_KEY_PREFIX + open.id,
        JSON.stringify({ title: open.title, body: open.body, savedAt: Date.now() }),
      );
    } catch {
      /* localStorage unavailable */
    }
  }, [open?.id, open?.title, open?.body]);

  // Cmd-N → new note, Cmd-S → flush save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void persist();
      } else if ((e.key === "n" || e.key === "N") && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        void onCreate();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist, open]);

  async function onCreate(parentId: string | null = null, title = "Untitled") {
    try {
      const n = await noteCreate(title, parentId, workspaceId);
      await refreshTree();
      setOpenId(n.id);
    } catch {
      toast.error("Couldn't create note");
    }
  }

  // Create-from-`+`-link: make the note and return it so the editor can insert
  // a link to it, but STAY in the current note (no setOpenId) — the author was
  // mid-sentence linking, not navigating away.
  async function onCreateNoteLink(title: string): Promise<{ id: string; title: string } | null> {
    try {
      const n = await noteCreate(title, null, workspaceId);
      await refreshTree();
      return { id: n.id, title: n.title ?? title };
    } catch {
      toast.error("Couldn't create note");
      return null;
    }
  }

  async function onTrash(id: string) {
    try {
      await noteTrash(id);
      toast.success("Moved to trash");
      if (openId === id) setOpenId(null);
      await refreshTree();
    } catch {
      toast.error("Couldn't trash note");
    }
  }

  async function onRestore(id: string) {
    try {
      await noteRestore(id);
      toast.success("Restored");
      await refreshTree();
    } catch {
      toast.error("Couldn't restore");
    }
  }

  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  function onDelete(id: string) {
    setDeleteCandidate(id);
  }
  async function performDelete(id: string) {
    try {
      await noteDelete(id);
      toast.success("Deleted");
      if (openId === id) setOpenId(null);
      await refreshTree();
    } catch {
      toast.error("Couldn't delete");
    }
  }

  // Search — 200ms debounce; abort in-flight on each keystroke.
  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    // Mark searching so the panel shows a loading hint instead of flashing
    // "No matches." over the previous/empty results while the fetch is pending.
    setSearching(true);
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const rows = await notesSearch(q, workspaceId, controller.signal);
        setSearchResults(rows);
        setSearching(false);
      } catch {
        // Aborted (user kept typing) → a newer run owns the state, leave
        // `searching` for it. Only a real failure clears the spinner.
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [searchQ, workspaceId]);

  return (
    <div className="notes-shell">
      <aside className="notes-tree">
        <div className="notes-tree-head">
          <button
            type="button"
            className="notes-newbtn"
            onClick={() => void onCreate(null)}
          >
            <Plus size={14} strokeWidth={2} />
            New page
          </button>
        </div>
        <div className="notes-tree-search">
          <Search size={13} strokeWidth={1.8} style={{ color: "var(--muted)" }} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search notes…"
            spellCheck={false}
            aria-label="Search notes"
          />
        </div>
        <div className="notes-tree-body">
          {loading ? (
            <TreeSkeleton />
          ) : searchQ.trim().length >= 2 ? (
            <SearchResults
              results={searchResults}
              searching={searching}
              activeId={openId}
              onPick={(id) => setOpenId(id)}
            />
          ) : treeError ? (
            <div role="alert" className="notes-tree-error">
              <div>Couldn&apos;t load notes — {treeError}</div>
              <button type="button" className="notes-tree-retry" onClick={() => void refreshTree()}>
                <RotateCw size={13} strokeWidth={1.8} />
                Try again
              </button>
            </div>
          ) : tree.length === 0 ? (
            <EmptyTree onCreate={() => void onCreate(null)} />
          ) : (
            <TreeView
              nodes={tree}
              activeId={openId}
              onPick={(id) => setOpenId(id)}
              onAddChild={(pid) => void onCreate(pid)}
              onTrash={(id) => void onTrash(id)}
            />
          )}
          {trashed.length > 0 && (
            <div className="notes-trash">
              <button
                type="button"
                className="notes-trash-toggle"
                onClick={() => setShowTrash((x) => !x)}
              >
                <ChevronRight
                  size={13}
                  style={{
                    transform: showTrash ? "rotate(90deg)" : "rotate(0)",
                    transition: "transform 160ms var(--ease)",
                  }}
                />
                Trash ({trashed.length})
              </button>
              {showTrash && (
                <ul className="notes-trash-list">
                  {trashed.map((n) => (
                    <li key={n.id}>
                      <span className="notes-trash-title">{n.title}</span>
                      <span className="notes-trash-actions">
                        <button
                          type="button"
                          title="Restore"
                          onClick={() => void onRestore(n.id)}
                          aria-label="Restore"
                        >
                          <RotateCw size={12} strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          title="Delete forever"
                          onClick={() => void onDelete(n.id)}
                          aria-label="Delete forever"
                        >
                          <Trash2 size={12} strokeWidth={1.8} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>

      <section className="notes-pane">
        {!open ? (
          <CenteredFiller>
            {treeError ? (
              <EmptyState
                icon={<NotebookPen size={28} strokeWidth={1.5} />}
                title="Couldn't load notes."
                subtitle={treeError}
                cta={
                  <button
                    type="button"
                    className="notes-newbtn"
                    onClick={() => void refreshTree()}
                  >
                    <RotateCw size={14} strokeWidth={2} />
                    Try again
                  </button>
                }
              />
            ) : tree.length === 0 ? (
              <EmptyState
                icon={<NotebookPen size={28} strokeWidth={1.5} />}
                title="No notes yet."
                subtitle="Notes are great for meeting minutes, READMEs, runbooks — anything you'd rather not stash in a file."
                cta={
                  <button
                    type="button"
                    className="notes-newbtn"
                    onClick={() => void onCreate(null)}
                  >
                    <Plus size={14} strokeWidth={2} />
                    Write your first note
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="Pick a note."
                subtitle="Choose a page from the tree on the left, or start a new one."
                cta={
                  <button
                    type="button"
                    className="notes-newbtn"
                    onClick={() => void onCreate(null)}
                  >
                    <Plus size={14} strokeWidth={2} />
                    New page
                  </button>
                }
              />
            )}
          </CenteredFiller>
        ) : (
          <NoteEditor
            note={open}
            tree={tree}
            workspaceId={workspaceId}
            saveState={saveState}
            savedAt={savedAt}
            onTitleChange={(title) =>
              setOpen((prev) => (prev ? { ...prev, title } : prev))
            }
            onBodyChange={(body) =>
              setOpen((prev) => (prev ? { ...prev, body } : prev))
            }
            onNavigateBacklink={(id) => setOpenId(id)}
            onTrash={() => open && void onTrash(open.id)}
            onCreateNote={onCreateNoteLink}
          />
        )}
      </section>

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Delete this note permanently?"
        body="This cannot be undone. The note + its body + backlinks index will be removed."
        confirmLabel="Delete permanently"
        variant="destructive"
        onConfirm={() => {
          if (deleteCandidate) return performDelete(deleteCandidate);
          return undefined;
        }}
        onClose={() => setDeleteCandidate(null)}
      />
    </div>
  );
}

// ── Tree view ────────────────────────────────────────────────────────

function TreeView({
  nodes,
  activeId,
  onPick,
  onAddChild,
  onTrash,
}: {
  nodes: NoteNode[];
  activeId: string | null;
  onPick: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onTrash: (id: string) => void;
}) {
  // Group children by parent for O(1) tree assembly.
  const byParent = useMemo(() => {
    const map = new Map<string | null, NoteNode[]>();
    for (const n of nodes) {
      const key = n.parent_id;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return map;
  }, [nodes]);

  const renderChildren = (parent: string | null, depth: number): React.ReactNode => {
    const children = byParent.get(parent) ?? [];
    if (children.length === 0) return null;
    return (
      <ul className="notes-tree-list">
        {children.map((c) => (
          <li key={c.id}>
            <div
              className={`notes-tree-row${activeId === c.id ? " active" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onPick(c.id)}
            >
              <span className="notes-tree-bullet" aria-hidden="true" />
              <span className="notes-tree-title">{c.title || "Untitled"}</span>
              <span className="notes-tree-rowactions">
                <button
                  type="button"
                  title="Add child page"
                  aria-label="Add child page"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChild(c.id);
                  }}
                >
                  <Plus size={11} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  title="Trash"
                  aria-label="Trash"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrash(c.id);
                  }}
                >
                  <Trash2 size={11} strokeWidth={1.8} />
                </button>
              </span>
            </div>
            {renderChildren(c.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return <>{renderChildren(null, 0)}</>;
}

function SearchResults({
  results,
  searching,
  activeId,
  onPick,
}: {
  results: NoteNode[];
  searching: boolean;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="notes-tree-empty">
        <span>{searching ? "Searching…" : "No matches."}</span>
      </div>
    );
  }
  return (
    <ul className="notes-tree-list">
      {results.map((r) => (
        <li key={r.id}>
          <div
            className={`notes-tree-row${activeId === r.id ? " active" : ""}`}
            style={{ paddingLeft: 8 }}
            onClick={() => onPick(r.id)}
          >
            <Search size={11} strokeWidth={1.7} style={{ color: "var(--muted-2)" }} />
            <span className="notes-tree-title">{r.title}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyTree({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="notes-tree-empty">
      <span>No pages yet.</span>
      <button type="button" onClick={onCreate}>
        Create one
      </button>
    </div>
  );
}

function TreeSkeleton() {
  return (
    <div className="notes-tree-skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <span
          key={i}
          style={{
            display: "block",
            height: 12,
            margin: "10px 12px",
            borderRadius: 4,
            background:
              "linear-gradient(90deg, var(--bg-subtle), var(--card) 40%, var(--bg-subtle))",
            backgroundSize: "200% 100%",
            animation: "cd-skeleton 1.4s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────

function NoteEditor({
  note,
  tree,
  workspaceId,
  saveState,
  savedAt,
  onTitleChange,
  onBodyChange,
  onNavigateBacklink,
  onTrash,
  onCreateNote,
}: {
  note: Note;
  tree: NoteNode[];
  workspaceId: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
  savedAt: number | null;
  onTitleChange: (title: string) => void;
  onBodyChange: (body: string) => void;
  onNavigateBacklink: (id: string) => void;
  onTrash: () => void;
  onCreateNote: (title: string) => Promise<{ id: string; title: string } | null>;
}) {
  return (
    <div className="notes-editor">
      <div className="notes-editor-head">
        <div className="notes-editor-actions">
          <span className="notes-save-state" aria-live="polite">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && savedAt && `Saved ${relTime(savedAt)} ago`}
            {saveState === "error" && (
              <span style={{ color: "var(--danger)" }}>Save failed</span>
            )}
            {saveState === "idle" && note.modified_at && (
              <>Last saved {relTime(new Date(note.modified_at).getTime())} ago</>
            )}
          </span>
          <button
            type="button"
            className="notes-trashbtn"
            onClick={onTrash}
            title="Move to trash"
            aria-label="Move to trash"
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <input
        className="notes-title"
        value={note.title}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onTitleChange(e.target.value)}
        placeholder="Title…"
        spellCheck
        maxLength={200}
        aria-label="Note title"
      />

      <MarkdownEditor
        key={note.id}
        value={note.body}
        onChange={onBodyChange}
        placeholder="Start writing — press / for blocks, @ to mention, + to link a note."
        id={`note-${note.id}-body`}
        workspaceId={workspaceId}
        notesTree={tree}
        onCreateNote={onCreateNote}
      />

      {note.backlinks.length > 0 && (
        <div className="notes-backlinks">
          <h3>Linked from</h3>
          <ul>
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onNavigateBacklink(b.id)}>
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────

function CenteredFiller({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.round(diff / 60)} min`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h`;
  return new Date(ts).toLocaleString();
}

// Markdown rendering moved into the Tiptap-backed MarkdownEditor
// (Phase 3 §17 §NT1 Phase 1). The renderer below was the old
// preview-pane code; the editor is now the document, so the standalone
// renderer is no longer needed in this file.
//
// Wiki-link resolution (`[[Title]]` → SPA link) is handled by the
// editor's link node — Phase 2 wires the `+` / `[[` picker; until then
// the existing markdown tokens render as plain `[[…]]` text. The
// backlinks index keeps working server-side regardless.
