import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight as ChevronRightSeparator,
  File as FileGeneric,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Link2,
  Lock,
  MoreHorizontal,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";

import * as api from "../api/client.ts";
import {
  ApiError,
  defaultFilters,
  downloadUrl,
  hasActiveFilters,
  searchAdvanced,
  searchContent,
  searchSemantic,
  type ContentHit,
  type SemanticHit,
  type FileDto,
  type FolderDto,
  type NoteSearchHit,
  type SearchFilters,
  type SearchResp,
  type SortBy as SearchSortBy,
  type SortDir as SearchSortDir,
  type Workspace,
} from "../api/client.ts";
import { useActiveWorkspaceId } from "../state/WorkspaceContext.tsx";
import { SearchToolbar } from "../components/SearchToolbar.tsx";
import { generateThumbnail } from "../api/thumbnail.ts";
import { disallowedUploadExtension } from "../api/uploadPolicy.ts";
import { EmptyState, EmptyStateButton } from "../components/EmptyState.tsx";
import { SkeletonRow, VAULT_GRID } from "../components/ds/SkeletonRow.tsx";
import { EntryContextMenu, EntryKebab, type Entry as MenuEntry, type EntryMenuHandlers } from "../components/EntryMenu.tsx";
import { inferKind, type FileKind } from "../components/FileThumb.tsx";
import { FileViewingDot } from "../components/FileViewingDot.tsx";
import { NoResultsRecovery } from "../components/NoResultsRecovery.tsx";
import { AskPanel, isQuestionLike } from "../components/AskPanel.tsx";
import { ResearchPanel } from "../components/ResearchPanel.tsx";
import { SearchSnippet } from "../components/SearchSnippet.tsx";
import { PreviewModal } from "../components/PreviewModal.tsx";
import { RenameDialog } from "../components/RenameDialog.tsx";
import { SelectionBar } from "../components/SelectionBar.tsx";
import { ShareDialog } from "../components/ShareDialog.tsx";
import { SortMenu, type SortDir, type SortKey } from "../components/SortMenu.tsx";
import type { Density, ViewMode } from "../components/TopBar.tsx";
import { PromptDialog } from "../components/PromptDialog.tsx";
import {
  decodeSearchState,
  encodeSearchState,
  isStateNonEmpty,
  type UrlState,
} from "../lib/searchUrl.ts";
import { recordRecent } from "../lib/recentSearches.ts";
import { usePresenceActions, usePresenceUsers } from "../state/PresenceContext.tsx";
import { useAuth } from "../auth/AuthContext.tsx";
import { markPaint } from "../lib/searchMetrics.ts";

const SORT_KEY_STORAGE = "cd-sort-key-v1";

/** SR6 — read search state from the address bar on mount. Wrapped in
 * try/catch + window guard so SSR / Safari quirks degrade to "empty
 * search" rather than throwing the SPA. */
function readInitialUrlState(): UrlState {
  if (typeof window === "undefined") {
    return decodeSearchState("");
  }
  try {
    return decodeSearchState(window.location.search);
  } catch {
    return decodeSearchState("");
  }
}

interface StoredSort {
  key: SortKey;
  dir: SortDir;
}

function loadStoredSort(): StoredSort {
  try {
    const raw = window.localStorage.getItem(SORT_KEY_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredSort>;
      const key: SortKey = ["name", "modified", "size"].includes(parsed.key as string)
        ? (parsed.key as SortKey)
        : "name";
      const dir: SortDir = parsed.dir === "desc" ? "desc" : "asc";
      return { key, dir };
    }
  } catch {
    /* ignored — fall through to defaults */
  }
  return { key: "name", dir: "asc" };
}

function persistSort(s: StoredSort) {
  try {
    window.localStorage.setItem(SORT_KEY_STORAGE, JSON.stringify(s));
  } catch {
    /* ignored */
  }
}

/**
 * Run `worker` over `items` with at most `n` in flight at once. Returns
 * the same shape as `Promise.allSettled` so the call site keeps working
 * the same way for partial-failure handling. Pipeline §6.6.
 */
async function mapWithConcurrency<I, O>(
  items: I[],
  n: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<PromiseSettledResult<O>[]> {
  const results: PromiseSettledResult<O>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await worker(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return results;
}

function entryId(e: Entry): string {
  return e.kind === "folder" ? e.folder.id : e.file.id;
}

interface Crumb {
  id: string | null; // null = root
  name: string;
}

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ready";
      folders: FolderDto[];
      files: FileDto[];
      /** Search-mode only — notes that matched the query. Folder
       * listing never sets this. The grid renders a small "Notes"
       * section above the folders+files when present. */
      notes?: NoteSearchHit[];
    }
  | { kind: "error"; message: string };

type Entry =
  | { kind: "folder"; folder: FolderDto }
  | { kind: "file"; file: FileDto };

export function Files({
  view,
  density,
  query,
  uploadRequested,
  onUploadHandled,
  newFolderRequested,
  onNewFolderHandled,
  newBlankRequested,
  newBlankKind,
  onNewBlankHandled,
  onItemCount,
}: {
  view: ViewMode;
  density: Density;
  query: string;
  uploadRequested: number;
  onUploadHandled: () => void;
  newFolderRequested: number;
  onNewFolderHandled: () => void;
  /** Bump to request a blank file create. Kind picks the template. */
  newBlankRequested: number;
  newBlankKind: "docx" | "xlsx" | null;
  onNewBlankHandled: () => void;
  onItemCount: (n: number) => void;
}) {
  // Active workspace — switching it resets the breadcrumb and refetches.
  const workspaceId = useActiveWorkspaceId();

  // Breadcrumb path: always starts with root.
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: "My Drive" }]);
  const current = path[path.length - 1];

  // When the workspace changes, drop the breadcrumb back to root — folder
  // ids from the prior workspace would 404 (or worse, leak metadata via
  // the find_by_id path) under the new scope.
  const lastWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (lastWorkspaceRef.current === workspaceId) return;
    lastWorkspaceRef.current = workspaceId;
    setPath([{ id: null, name: "My Drive" }]);
  }, [workspaceId]);

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Drag-to-move: which folder (or breadcrumb crumb) the pointer is over, and
  // the entry ids being dragged. Ids live in a ref because dataTransfer can't
  // be read during dragover (only on drop) in some browsers.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedIdsRef = useRef<string[]>([]);

  // Preview modal
  // Preview/details modal is identified by FILE ID, never a list index — an
  // index goes stale the moment the list mutates (trash/rename/upload), which
  // made "trash a file → the modal shows a DIFFERENT file". The index the
  // modal needs is derived from this id at render time; if the id leaves the
  // list, the modal closes instead of pointing at whatever shifted into place.
  const [previewId, setPreviewId] = useState<string | null>(null);
  // A file opened from the palette / a search hit that isn't in the current
  // pane. Held HERE rather than by overwriting the grid's `state` — clobbering
  // `state` destroyed the folder/search listing and never restored it. When
  // set, the preview renders from this singleton and the grid is untouched.
  const [previewOverride, setPreviewOverride] = useState<FileDto | null>(null);

  // Rename dialog
  const [renaming, setRenaming] = useState<MenuEntry | null>(null);

  // Share dialog (files only — folder shares are v0.2)
  const [sharing, setSharing] = useState<FileDto | null>(null);

  // Sort — persisted to localStorage.
  const [sort, setSort] = useState<StoredSort>(loadStoredSort);
  function changeSort(key: SortKey, dir: SortDir) {
    const next = { key, dir };
    setSort(next);
    persistSort(next);
  }

  // Multi-select.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  // Track whether the latest load was a search vs a folder listing so we
  // know if the user's `query` is "live" against the rendered set.
  const [searched, setSearched] = useState(false);

  // Phase 3 search — chip-driven filters + cursor pagination.
  // SR6 — initial state is read from URL search params so reload +
  // deep-link land back on the same search. The encode/decode pair
  // lives in `lib/searchUrl.ts`; defaults are omitted so a clean URL
  // means a clean state.
  const initialUrl = readInitialUrlState();
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(initialUrl.filters);
  const [searchSort, setSearchSort] = useState<SearchSortBy>(initialUrl.sort);
  const [searchSortDir, setSearchSortDir] = useState<SearchSortDir>(initialUrl.sortDir);
  const [searchMeta, setSearchMeta] = useState<{
    total: { files: number; folders: number; notes: number; exact: boolean };
    nextCursor: string | null;
    sortApplied: SearchSortBy;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Phase 3 §2 — content matches (text found INSIDE documents), shown in a
  // dedicated "In documents" section beneath the name/metadata grid. Fetched
  // in parallel with the metadata search and de-duped against its files.
  const [contentHits, setContentHits] = useState<ContentHit[]>([]);
  // Phase 5 (RAG) — semantic matches (passages related by MEANING), shown in a
  // "Related by meaning" section beneath the content matches. Fetched in
  // parallel and de-duped against both the name matches and the content hits.
  const [semanticHits, setSemanticHits] = useState<SemanticHit[]>([]);

  // SR6 — keep the URL in sync with the current search state. Writes
  // via `history.replaceState` so back/forward isn't polluted with a
  // history entry per keystroke. Skips the write when the serialized
  // string already matches what's in the address bar (avoids a
  // re-render storm when the popstate handler below echoes state
  // through). Routes that aren't "search" (everything-default) clear
  // the query string entirely so the URL doesn't read like noise.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = encodeSearchState({
      query,
      filters: searchFilters,
      sort: searchSort,
      sortDir: searchSortDir,
    });
    const hasContent = isStateNonEmpty({
      query,
      filters: searchFilters,
      sort: searchSort,
      sortDir: searchSortDir,
    });
    const current = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    if (next === current) return;
    const url =
      hasContent && next.length > 0
        ? `${window.location.pathname}?${next}${window.location.hash}`
        : `${window.location.pathname}${window.location.hash}`;
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* private mode / sandboxed iframes can throw — silent. */
    }
  }, [query, searchFilters, searchSort, searchSortDir]);

  // SR6 — back / forward replays the URL into local state. The
  // popstate event fires after the browser updates `window.location`,
  // so we just decode the latest. Query is owned by Shell.tsx; emit a
  // `cd:search-query` event for it to pick up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop() {
      const decoded = decodeSearchState(window.location.search);
      setSearchFilters(decoded.filters);
      setSearchSort(decoded.sort);
      setSearchSortDir(decoded.sortDir);
      window.dispatchEvent(
        new CustomEvent<string>("cd:search-query", { detail: decoded.query }),
      );
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // SR11 — TopBar dispatches `cd:search-commit` on Enter / blur with
  // a non-empty query. We pair the query with the currently-active
  // filter snapshot and record both — the dropdown re-applies both
  // when the user clicks an entry. Dedup + cap-to-10 lives in the
  // helper.
  useEffect(() => {
    function onCommit(e: Event) {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q !== "string" || q.trim().length === 0) return;
      recordRecent(q, searchFilters);
      window.dispatchEvent(new Event("cd:recents-changed"));
    }
    function onApplyFilters(e: Event) {
      const detail = (e as CustomEvent<SearchFilters>).detail;
      if (detail && typeof detail === "object") {
        setSearchFilters({ ...defaultFilters(), ...detail });
      }
    }
    window.addEventListener("cd:search-commit", onCommit);
    window.addEventListener("cd:apply-filters", onApplyFilters);
    return () => {
      window.removeEventListener("cd:search-commit", onCommit);
      window.removeEventListener("cd:apply-filters", onApplyFilters);
    };
  }, [searchFilters]);

  // Workspaces list — needed for the SearchToolbar's Workspace chip
  // (only when the user has more than one) and scope picker.
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.listWorkspaces();
        if (alive) setWorkspaces(r.workspaces);
      } catch {
        /* ignored — toolbar degrades gracefully without the list */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Whether to show the search UI vs the folder listing. Driven by
  // either a non-trivial query OR any active chip filter.
  const inSearchMode = query.trim().length >= 2 || hasActiveFilters(searchFilters);

  // SR7 — re-run-after-action signal. When `refresh()` is called from
  // inside search mode (after a rename / trash / share / bulk op) we
  // must NOT swap the result pane back to a folder listing; the
  // query is still in the input and that would be a confusing snap.
  // Bumping this tick causes the search effect to re-fire with the
  // current filter set.
  const [searchRefreshTick, setSearchRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    // SR7 — search-mode refresh re-runs the search instead of pulling
    // a folder listing. The search effect picks up the tick and
    // re-fetches `/api/search` with the current q + filters + sort.
    if (inSearchMode) {
      setSearchRefreshTick((t) => t + 1);
      return;
    }
    setState({ kind: "loading" });
    setSearched(false);
    try {
      if (current.id === null) {
        const data = await api.listRoot(workspaceId);
        setState({ kind: "ready", folders: data.folders, files: data.files });
        onItemCount(data.folders.length + data.files.length);
      } else {
        const detail = await api.getFolder(current.id);
        setState({
          kind: "ready",
          folders: detail.children.folders,
          files: detail.children.files,
        });
        onItemCount(detail.children.folders.length + detail.children.files.length);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 401
            ? "Signed out for security."
            : `Couldn't load files (${err.status}).`
          : "Couldn't reach the server.";
      setState({ kind: "error", message: msg });
    }
  }, [current, inSearchMode, onItemCount, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cmd-K palette → "open file" routes here via a CustomEvent. We look
  // up the file in whichever list is currently rendered; if it's not
  // there (different folder or a search result that didn't survive the
  // last fetch), fall back to fetching its metadata and opening anyway.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      if (state.kind !== "ready") return;
      const idx = state.files.findIndex((f) => f.id === id);
      if (idx >= 0) {
        setPreviewId(id);
        return;
      }
      // Not in the current pane — fetch its metadata and preview it as an
      // OVERRIDE, leaving the grid's `state` (folder listing / search results)
      // completely intact. Route through the api client so it works in demo
      // mode (raw fetch bypasses the demo shim) and surfaces auth errors.
      void (async () => {
        const meta = await api.getFile(id).catch(() => null);
        if (meta) {
          setPreviewOverride(meta);
          setPreviewId(meta.id);
        }
      })();
    }
    window.addEventListener("cd:open-file", onOpen);
    return () => window.removeEventListener("cd:open-file", onOpen);
  }, [state]);

  // Phase 3 search effect — drives /api/search with the chip filter
  // set + sort + pagination. 50 ms debounce on every input change to
  // meet the SR15 spec budget (p95 keystroke→paint < 200 ms); was
  // 200 ms but that alone ate the entire user-perceived wait.
  // AbortController cancels the in-flight request on each new keystroke
  // or filter flip so stale responses never overwrite fresh ones, so
  // a tighter debounce just means more cancels — not more wasted work.
  useEffect(() => {
    if (!inSearchMode) {
      // Returned to neutral (no query + no filters) → folder listing.
      if (searched) {
        setSearched(false);
        setSearchMeta(null);
        setContentHits([]);
        setSemanticHits([]);
        void refresh();
      }
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setState({ kind: "loading" });
      // Content search (text inside documents) runs in parallel with the
      // metadata search; it never blocks or fails the primary results.
      const q = query.trim();
      const contentP = q
        ? searchContent(q, { limit: 20, signal: controller.signal }).catch(() => [])
        : Promise.resolve<ContentHit[]>([]);
      // Semantic (meaning-based) retrieval runs alongside content search;
      // like it, it never blocks or fails the primary results.
      const semanticP = q
        ? searchSemantic(q, { limit: 10, signal: controller.signal }).catch(() => [])
        : Promise.resolve<SemanticHit[]>([]);
      try {
        const filters: SearchFilters = { ...searchFilters, q };
        const data: SearchResp = await searchAdvanced(
          filters,
          { sort: searchSort, sort_dir: searchSortDir, limit: 30 },
          controller.signal,
        );
        setState({
          kind: "ready",
          folders: data.folders,
          files: data.files,
          notes: data.notes,
        });
        // De-dupe layered results so a file appears in at most one section:
        // name/metadata grid → "In documents" (content) → "Related by meaning"
        // (semantic). Each section excludes files already shown above it.
        const nameIds = new Set(data.files.map((f) => f.id));
        void Promise.all([contentP, semanticP]).then(([cHits, sHits]) => {
          if (controller.signal.aborted) return;
          const contentFiltered = cHits.filter((h) => !nameIds.has(h.file_id));
          setContentHits(contentFiltered);
          const shownIds = new Set([
            ...nameIds,
            ...contentFiltered.map((h) => h.file_id),
          ]);
          setSemanticHits(sHits.filter((h) => !shownIds.has(h.file_id)));
        });
        setSearched(true);
        setSearchMeta({
          total: data.total,
          nextCursor: data.next_cursor ?? null,
          sortApplied: data.sort_applied,
        });
        onItemCount(data.folders.length + data.files.length + data.notes.length);
        // SR15 — close the keystroke→paint measurement window AFTER
        // the browser has painted the new result pane. Double-rAF
        // pushes us past React's commit (rAF #1) and into the next
        // composited frame (rAF #2), so the timestamp lines up with
        // what the user actually sees.
        requestAnimationFrame(() => requestAnimationFrame(markPaint));
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof ApiError
            ? err.status === 401
              ? "Signed out for security."
              : `Search failed (${err.status}).`
            : "Couldn't reach the server.";
        setState({ kind: "error", message: msg });
      }
    }, 50);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // refresh + searched + setters are intentionally not in the dep set
    // — they would re-fire the effect every render. Only the live
    // search inputs should re-trigger search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    inSearchMode,
    searchFilters,
    searchSort,
    searchSortDir,
    workspaceId,
    onItemCount,
    // SR7 — re-run the search when an in-place action (rename / trash
    // / share / bulk op) calls `refresh()` while in search mode.
    searchRefreshTick,
  ]);

  // Infinite scroll: when in search mode + a next_cursor exists,
  // fetch and append the next page. Triggered by an IntersectionObserver
  // attached to a sentinel ~2 viewports below the result list.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!inSearchMode || !searchMeta?.nextCursor || loadingMore) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (loadingMore || !searchMeta?.nextCursor) return;
        setLoadingMore(true);
        void (async () => {
          try {
            const filters: SearchFilters = { ...searchFilters, q: query.trim() };
            const data = await searchAdvanced(filters, {
              sort: searchSort,
              sort_dir: searchSortDir,
              limit: 30,
              after: searchMeta.nextCursor!,
            });
            setState((s) =>
              s.kind === "ready"
                ? {
                    kind: "ready",
                    folders: [...s.folders, ...data.folders],
                    files: [...s.files, ...data.files],
                    notes: [...(s.notes ?? []), ...data.notes],
                  }
                : s,
            );
            setSearchMeta((m) =>
              m
                ? {
                    total: data.total,
                    nextCursor: data.next_cursor ?? null,
                    sortApplied: data.sort_applied,
                  }
                : m,
            );
          } catch {
            /* swallowed — caller will retry by scrolling again */
          } finally {
            setLoadingMore(false);
          }
        })();
      },
      { rootMargin: "0px 0px 800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    inSearchMode,
    searchMeta?.nextCursor,
    loadingMore,
    searchFilters,
    searchSort,
    searchSortDir,
    query,
  ]);

  // Parent-triggered upload + new-folder. Both use a "tick" counter
  // that the parent increments on action. We track the last seen tick
  // in a ref so the effect only fires when the prop CHANGES — not on
  // mount with a carried-over value. Without this, switching tabs and
  // returning re-mounts <Files/> with the old tick still > 0 and the
  // file picker keeps popping open unprompted.
  const lastUploadTickRef = useRef(uploadRequested);
  useEffect(() => {
    if (uploadRequested === lastUploadTickRef.current) return;
    lastUploadTickRef.current = uploadRequested;
    if (uploadRequested > 0) {
      fileInputRef.current?.click();
      onUploadHandled();
    }
  }, [uploadRequested, onUploadHandled]);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const lastNewFolderTickRef = useRef(newFolderRequested);
  useEffect(() => {
    if (newFolderRequested === lastNewFolderTickRef.current) return;
    lastNewFolderTickRef.current = newFolderRequested;
    if (newFolderRequested === 0) return;
    setNewFolderOpen(true);
    onNewFolderHandled();
  }, [newFolderRequested, onNewFolderHandled, refresh, current.id]);

  // Blank-template creation (docx / xlsx). Sidebar bumps the tick + sets
  // the kind; we fetch the bundled template, wrap it as a File with a
  // unique name in the current folder, and route through the same
  // upload path so progress / quota / thumbnails behave consistently.
  const lastNewBlankTickRef = useRef(newBlankRequested);
  useEffect(() => {
    if (newBlankRequested === lastNewBlankTickRef.current) return;
    lastNewBlankTickRef.current = newBlankRequested;
    if (newBlankRequested === 0 || !newBlankKind) return;
    void (async () => {
      onNewBlankHandled();
      try {
        const ext = newBlankKind;
        const mime =
          ext === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        // Tiny timestamp suffix so back-to-back New clicks don't collide.
        // Drive's PATCH /api/files/{id} rename is one click away if the
        // user wants something nicer.
        const base = ext === "docx" ? "Untitled" : "Untitled spreadsheet";
        const stamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(2, 12); // YYMMDDhhmm
        const name = `${base} ${stamp}.${ext}`;
        // Prefix with Vite's BASE_URL — on local dev the SPA is served at /,
        // on Pages it's served at /demo-app/, and the templates live under
        // both. Hardcoding `/templates/...` made the Pages build 404.
        const resp = await fetch(`${import.meta.env.BASE_URL}templates/blank.${ext}`);
        if (!resp.ok) throw new Error(`template fetch failed: HTTP ${resp.status}`);
        const blob = await resp.blob();
        const file = new File([blob], name, { type: mime });
        const thumb = await generateThumbnail(file).catch(() => null);
        const created = await api.uploadFile(file, current.id, thumb, workspaceId);
        toast.success(`Created ${created.name}`);
        refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create file";
        toast.error(msg);
      }
    })();
  }, [
    newBlankRequested,
    newBlankKind,
    onNewBlankHandled,
    refresh,
    current.id,
    workspaceId,
  ]);

  const uploadAll = useCallback(
    async (files: FileList | File[]) => {
      const all = Array.from(files);
      if (all.length === 0) return;

      // Client-side allowlist — save the round-trip when we already know the
      // server will refuse. Doc-Hub is documents-only; the server enforces the
      // same allowlist (plus a byte-level sniff we can't do here).
      const blocked = all.filter((f) => disallowedUploadExtension(f.name) !== null);
      const list = all.filter((f) => disallowedUploadExtension(f.name) === null);
      if (blocked.length > 0) {
        const exts = Array.from(
          new Set(
            blocked.map((f) => {
              const ext = disallowedUploadExtension(f.name);
              return ext ? `.${ext}` : "(no extension)";
            }),
          ),
        ).join(", ");
        toast.error(
          `${blocked.length} not supported: ${exts}`,
          { description: "Only documents can go in the hub — spreadsheets, docs, PDFs, and text." },
        );
      }
      if (list.length === 0) return;

      setUploading(list.map((f) => f.name));
      // Pipeline §6.6 — concurrent upload cap. Dragging in 20 files
      // shouldn't open 20 multipart connections + spin 20 thumbnail
      // canvases at once. Cap at 4; mirrors the server's per-user upload
      // rate limit so we batch instead of bursting.
      const results = await mapWithConcurrency(list, 4, async (f) => {
        const thumb = await generateThumbnail(f).catch(() => null);
        return api.uploadFile(f, current.id, thumb, workspaceId);
      });
      setUploading([]);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      // Any failure here is server-side (network, quota, magic-byte sniff
      // once it lands). Surface the first explanatory error inline.
      const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (ok === list.length) {
        toast.success(`Uploaded ${ok} ${ok === 1 ? "file" : "files"}`);
      } else if (ok > 0) {
        toast.warning(`Uploaded ${ok} of ${list.length}, ${list.length - ok} failed`);
      } else if (firstErr) {
        const e = firstErr.reason as { status?: number; body?: { error?: string; extension?: string } };
        if (e?.status === 415 && e?.body?.extension) {
          toast.error(`.${e.body.extension} files aren't allowed.`);
        } else {
          toast.error(e?.body?.error ?? "Upload failed");
        }
      }
      void refresh();
    },
    [refresh, current.id, workspaceId],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void uploadAll(e.dataTransfer.files);
  }

  // ─── Drag-to-move (files/folders → a folder or breadcrumb crumb) ────────
  function beginEntryDrag(entry: Entry, e: React.DragEvent) {
    const id = entryId(entry);
    // Dragging a selected item moves the whole selection; otherwise just it.
    const ids = selection.has(id) && selection.size > 0 ? Array.from(selection) : [id];
    draggedIdsRef.current = ids;
    e.dataTransfer.effectAllowed = "move";
    // Marker so an OS-file drop (upload) is still distinguishable from an
    // internal move — internal drags carry this custom type.
    e.dataTransfer.setData("application/x-dochub-move", ids.join(","));
    e.dataTransfer.setData("text/plain", ids.join(","));
  }
  function endEntryDrag() {
    draggedIdsRef.current = [];
    setDropTargetId(null);
  }
  // A move is in progress if we have dragged ids (internal drag), used to gate
  // folder/crumb dragover highlighting so OS-file uploads don't light folders.
  function isInternalMove(e: React.DragEvent) {
    return (
      draggedIdsRef.current.length > 0 ||
      e.dataTransfer.types.includes("application/x-dochub-move")
    );
  }
  async function moveDraggedInto(targetFolderId: string | null) {
    // Never drop an item onto itself.
    const ids = draggedIdsRef.current.filter((id) => id !== targetFolderId);
    endEntryDrag();
    if (ids.length === 0) return;
    const byId = new Map<string, Entry>(filteredEntries.map((en) => [entryId(en), en]));
    const results = await Promise.allSettled(
      ids.map((id) => {
        const en = byId.get(id);
        if (!en) return Promise.resolve();
        return en.kind === "folder"
          ? api.moveFolder(en.folder.id, targetFolderId)
          : api.moveFile(en.file.id, targetFolderId);
      }),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (ok > 0) {
      toast.success(`Moved ${ok} item${ok === 1 ? "" : "s"}`);
      setSelection(new Set());
      void refresh();
    }
    if (failed > 0) toast.error(`Couldn't move ${failed} item${failed === 1 ? "" : "s"}`);
  }

  const dragProps: DragProps = {
    onEntryDragStart: beginEntryDrag,
    onEntryDragEnd: endEntryDrag,
    onFolderDragOver: (folderId, e) => {
      if (!isInternalMove(e)) return; // OS-file drags fall through to upload
      const ids = draggedIdsRef.current;
      if (ids.length === 1 && ids[0] === folderId) return; // can't drop onto self
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(folderId);
    },
    onFolderDragLeave: (folderId) =>
      setDropTargetId((cur) => (cur === folderId ? null : cur)),
    onFolderDrop: (folderId, e) => {
      e.preventDefault();
      void moveDraggedInto(folderId);
    },
    onCrumbDragOver: (crumbId, e) => {
      if (!isInternalMove(e)) return;
      const key = crumbId ?? CRUMB_ROOT_KEY;
      // Dropping onto the crumb of the folder you're already in is a no-op.
      if (crumbId === (path[path.length - 1]?.id ?? null)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(key);
    },
    onCrumbDragLeave: (crumbId) =>
      setDropTargetId((cur) => (cur === (crumbId ?? CRUMB_ROOT_KEY) ? null : cur)),
    onCrumbDrop: (crumbId, e) => {
      e.preventDefault();
      void moveDraggedInto(crumbId);
    },
    dropTargetId,
  };
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) void uploadAll(e.target.files);
    e.target.value = "";
  }

  function enterFolder(f: FolderDto) {
    setPath((p) => [...p, { id: f.id, name: f.name }]);
  }
  function goBack() {
    setPath((p) => (p.length > 1 ? p.slice(0, -1) : p));
  }
  function jumpTo(idx: number) {
    setPath((p) => p.slice(0, idx + 1));
  }

  // Filter for search + sort. Folders always come before files within the
  // chosen sort key; that's the spec, and it matches every reference Drive.
  const filteredEntries = useMemo<Entry[]>(() => {
    if (state.kind !== "ready") return [];
    const q = query.trim().toLowerCase();
    const folders = state.folders
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .map((f) => ({ kind: "folder" as const, folder: f }));
    const files = state.files
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .map((f) => ({ kind: "file" as const, file: f }));

    const cmp = (a: Entry, b: Entry): number => {
      switch (sort.key) {
        case "modified": {
          const ta = (a.kind === "folder" ? a.folder.modified_at : a.file.modified_at) ?? "";
          const tb = (b.kind === "folder" ? b.folder.modified_at : b.file.modified_at) ?? "";
          return ta.localeCompare(tb);
        }
        case "size": {
          // Folders don't have a recursive size in v0 — fall back to name
          // for parity. Files compare numerically.
          if (a.kind === "folder" && b.kind === "folder") {
            return a.folder.name.localeCompare(b.folder.name, undefined, { numeric: true });
          }
          if (a.kind === "file" && b.kind === "file") {
            return a.file.size - b.file.size;
          }
          return 0;
        }
        case "name":
        default: {
          const na = a.kind === "folder" ? a.folder.name : a.file.name;
          const nb = b.kind === "folder" ? b.folder.name : b.file.name;
          return na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
        }
      }
    };

    folders.sort(cmp);
    files.sort(cmp);
    if (sort.dir === "desc") {
      folders.reverse();
      files.reverse();
    }
    return [...folders, ...files];
  }, [state, query, sort]);

  const total = filteredEntries.length;
  const fileList = useMemo(
    () => filteredEntries.filter((e): e is { kind: "file"; file: FileDto } => e.kind === "file").map((e) => e.file),
    [filteredEntries],
  );

  // RT4 — quiet peer-action toast. Watches the rolling action buffer
  // (PresenceContext) and pops a sonner toast when a peer renames /
  // trashes / etc. a file that's currently in the user's grid. Self-
  // actions and out-of-view targets are silently skipped per the
  // brief ("don't spam"). lastSeenTsRef dedupes across renders;
  // we only ever consider entries newer than the last batch.
  const presenceActions = usePresenceActions();
  const presenceUsers = usePresenceUsers();
  const { status: authStatus } = useAuth();
  const myUserId = authStatus.kind === "authed" ? authStatus.me.user_id ?? null : null;
  const lastSeenActionTsRef = useRef(0);
  useEffect(() => {
    if (presenceActions.length === 0) return;
    // Build a quick lookup for currently-rendered targets. Both file
    // and folder ids count — folder rename events still need to land.
    const visibleIds = new Set<string>();
    for (const e of filteredEntries) {
      visibleIds.add(e.kind === "file" ? e.file.id : e.folder.id);
    }
    let dirty = false;
    let newestTs = lastSeenActionTsRef.current;
    // Walk oldest-first so toasts fire in chronological order on the
    // initial burst (`presenceActions` is newest-first per the
    // PresenceContext spec).
    for (let i = presenceActions.length - 1; i >= 0; i--) {
      const a = presenceActions[i];
      if (a.received_at <= lastSeenActionTsRef.current) continue;
      if (a.received_at > newestTs) newestTs = a.received_at;
      if (myUserId && a.user_id === myUserId) continue;
      if (!a.target_id || !visibleIds.has(a.target_id)) continue;
      const verb = verbFor(a.action);
      if (!verb) continue;
      const actor = presenceUsers.find((u) => u.user_id === a.user_id)?.username ?? "Someone";
      const targetName = a.target_name ?? "a file";
      toast.message(`${actor} ${verb} ${targetName}`, { duration: 3000 });
      dirty = true;
    }
    lastSeenActionTsRef.current = newestTs;
    // Re-pull so the renamed name actually reflects in the row the
    // user just got toasted about. The search-aware refresh handles
    // both browse + search modes.
    if (dirty) void refresh();
    // refresh is intentionally not in deps — it's stable per-render
    // via useCallback and adding it would re-fire the effect on
    // every workspace change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceActions, filteredEntries, presenceUsers, myUserId]);

  // Per-entry menu handlers — built once, accept the entry inline so the
  // menu in every row/card binds to the right target.
  //
  // Click model (user directive, 2026-06-16):
  //   - Single left-click on a card → PreviewModal (metadata + preview)
  //     for ALL file types — video, md, pdf, sheet, docx, image, etc.
  //   - Double left-click on a card → `/file/<id>` editor view, also
  //     for ALL file types.
  //   - Menu "Open" mirrors double-click (jump to the editor route).
  //   - Menu "Preview" mirrors single-click (modal).
  //   - Menu "See details" mirrors Preview today; Phase 2 will replace
  //     it with a dedicated details panel (sharing + roles + audit log).
  //
  // Single-click debounce — the browser always fires `click` before
  // `dblclick`, so a naive single-click handler that opens the modal
  // would intercept the second click and the dblclick handler would
  // never fire (or fire against the modal overlay). Hold the
  // single-click action behind a 250 ms timer; if a dblclick lands
  // first, cancel the pending modal and route to the editor instead.
  const singleClickTimerRef = useRef<number | null>(null);
  function openInEditorRoute(entry: Entry) {
    if (singleClickTimerRef.current !== null) {
      window.clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = null;
    }
    if (entry.kind === "folder") {
      enterFolder(entry.folder);
      return;
    }
    const url = `/document/${encodeURIComponent(entry.file.id)}/edit`;
    window.history.pushState({ file: entry.file }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  function handleSingleOrDouble(file: FileDto, _idx: number) {
    if (singleClickTimerRef.current !== null) {
      window.clearTimeout(singleClickTimerRef.current);
    }
    singleClickTimerRef.current = window.setTimeout(() => {
      singleClickTimerRef.current = null;
      setPreviewId(file.id);
    }, 250);
  }

  function handlersFor(entry: MenuEntry): EntryMenuHandlers {
    // `Open` → editor route for every file type. The FileFullscreen
    // page already branches on inferKind to mount the right SDK
    // (CasualDoc / CasualSheet / image viewer / video / PDF / text /
    // generic download), so this works for non-editor types too.
    const openInEditor = (target: FileDto) => {
      const url = `/document/${encodeURIComponent(target.id)}/edit`;
      window.history.pushState({ file: target }, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
    const preview = (id: string) => {
      if (fileList.some((f) => f.id === id)) setPreviewId(id);
    };
    const open = (id: string) => {
      const target = fileList.find((f) => f.id === id);
      if (target) openInEditor(target);
    };
    // `See details` opens the same PreviewModal as Preview today.
    // Phase 2 swaps to a dedicated panel that shows people-with-access
    // (sharing) + manage-by-roles + audit log of that file.
    const details = (id: string) => preview(id);
    if (entry.kind === "folder") {
      return {
        onOpen: () => enterFolder(entry.folder),
        onRename: () => setRenaming(entry),
        onTrash: () => {
          toast.info("Folder trash is coming in v0.2.", {
            description: "The recursive trash + restore flow ships alongside the Trash surface.",
          });
        },
      };
    }
    const file = entry.file;
    return {
      onOpen: () => open(file.id),
      onPreview: () => preview(file.id),
      onDetails: () => details(file.id),
      onHistory: () => {
        const url = `/document/${encodeURIComponent(file.id)}/history`;
        window.history.pushState({ file }, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      onRename: () => setRenaming(entry),
      onShare: () => setSharing(file),
      onDownload: () => {
        const url = downloadUrl(file.id);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      },
      onTrash: async () => {
        try {
          await api.trashFile(file.id);
          toast.success(`Moved "${file.name}" to trash`);
          void refresh();
        } catch {
          toast.error("Couldn't trash the file.");
        }
      },
    };
  }

  // Backspace = back (when not typing). ⌘/Ctrl-A selects every entry. Esc
  // clears selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "Backspace" && !typing && path.length > 1) {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key === "Escape" && selection.size > 0) {
        // Let an open dialog own Escape (Radix closes it); don't also wipe
        // the selection out from under the user on the same keypress.
        const dialogOpen =
          renaming !== null || sharing !== null || newFolderOpen || previewId !== null;
        if (dialogOpen) return;
        e.preventDefault();
        setSelection(new Set());
        return;
      }
      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && filteredEntries.length > 0) {
        e.preventDefault();
        setSelection(new Set(filteredEntries.map(entryId)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path.length, selection.size, filteredEntries, renaming, sharing, newFolderOpen, previewId]);

  // Selection always resets when the folder changes — carrying a selection
  // across folder boundaries is a v0.2 polish (would need bulk-move-by-id).
  useEffect(() => {
    setSelection(new Set());
    setSelectionAnchor(null);
  }, [current.id]);

  // Pointer-driven selection: clicks dispatch on modifier keys. Returns
  // `true` if the caller should still treat the click as an "open" action
  // (no selection happened, single bare click on already-selected item).
  function handleEntryClick(
    e: React.MouseEvent,
    entry: Entry,
    list: Entry[],
  ): "open" | "selected" {
    const id = entryId(entry);
    if (e.shiftKey && selectionAnchor) {
      const from = list.findIndex((x) => entryId(x) === selectionAnchor);
      const to = list.findIndex((x) => entryId(x) === id);
      if (from === -1 || to === -1) return "selected";
      const [a, b] = from < to ? [from, to] : [to, from];
      const range = list.slice(a, b + 1).map(entryId);
      const next = new Set(selection);
      range.forEach((rid) => next.add(rid));
      setSelection(next);
      return "selected";
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelection(next);
      setSelectionAnchor(id);
      return "selected";
    }
    // Plain click: if there's an existing multi-selection, replace it with
    // just this item and proceed to open. If this item is the only one
    // already selected, treat as open. Otherwise replace selection.
    if (selection.size === 0) {
      setSelectionAnchor(id);
      return "open";
    }
    setSelection(new Set());
    setSelectionAnchor(id);
    return "open";
  }

  async function bulkTrash() {
    const ids = Array.from(selection);
    const fileIds = ids.filter((id) =>
      filteredEntries.some((e) => e.kind === "file" && e.file.id === id),
    );
    const folderCount = ids.length - fileIds.length;
    if (folderCount > 0) {
      toast.info("Folder trash is coming in v0.2.", {
        description: `${folderCount} folder${folderCount === 1 ? "" : "s"} skipped.`,
      });
    }
    const results = await Promise.allSettled(fileIds.map((id) => api.trashFile(id)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok > 0) toast.success(`Moved ${ok} file${ok === 1 ? "" : "s"} to trash`);
    if (ok < fileIds.length) toast.error(`${fileIds.length - ok} failed`);
    setSelection(new Set());
    void refresh();
  }

  function bulkDownload() {
    const fileIds = Array.from(selection).filter((id) =>
      filteredEntries.some((e) => e.kind === "file" && e.file.id === id),
    );
    if (fileIds.length === 0) {
      toast.info("Folder download is coming in v0.2.");
      return;
    }
    fileIds.forEach((id) => {
      const entry = filteredEntries.find((e) => e.kind === "file" && e.file.id === id) as
        | { kind: "file"; file: FileDto }
        | undefined;
      if (!entry) return;
      const a = document.createElement("a");
      a.href = downloadUrl(entry.file.id);
      a.download = entry.file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    toast.success(`Downloading ${fileIds.length} file${fileIds.length === 1 ? "" : "s"}`);
  }

  return (
    <div
      data-density={density}
      className="cd-files-page"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-canvas)",
        overflow: "auto",
        padding: "var(--space-4) var(--space-6) 40px",
      }}
    >
      <Header
        path={path}
        searching={inSearchMode}
        count={total}
        searchTotals={
          inSearchMode && searchMeta
            ? {
                files: searchMeta.total.files,
                folders: searchMeta.total.folders,
                notes: searchMeta.total.notes,
                exact: searchMeta.total.exact,
              }
            : undefined
        }
        contentCount={contentHits.length}
        onBack={goBack}
        onJumpTo={jumpTo}
        sort={sort}
        onSortChange={changeSort}
        showSort={!inSearchMode && state.kind === "ready" && total > 0}
        drag={dragProps}
      />

      {inSearchMode && (
        <SearchToolbar
          filters={searchFilters}
          sort={searchSort}
          sortDir={searchSortDir}
          workspaces={workspaces}
          activeWorkspaceName={
            workspaces.find((w) => w.id === workspaceId)?.name ?? "This workspace"
          }
          insideFolder={path.length > 1}
          activeWorkspaceId={workspaceId}
          onFiltersChange={setSearchFilters}
          onSortChange={(s, d) => {
            setSearchSort(s);
            setSearchSortDir(d);
          }}
          onClearAll={() => setSearchFilters(defaultFilters(searchFilters.scope))}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onFilePicked}
        style={{ display: "none" }}
      />

      <Stage key={current.id ?? "root"}>
        {/* RAG answer (Phase 5) — shown above results when the query reads
            like a question. Renders nothing otherwise. */}
        {inSearchMode && (
          <AskPanel
            query={query.trim()}
            workspace={workspaceId}
            onOpenFile={(id) => {
              window.dispatchEvent(
                new CustomEvent<string>("cd:open-file", { detail: id }),
              );
            }}
          />
        )}
        {/* Agentic research — a deliberate, multi-step escalation of the ask,
            offered for the same question-like queries. Renders its own trigger. */}
        {inSearchMode && isQuestionLike(query.trim()) && (
          <ResearchPanel
            query={query.trim()}
            workspace={workspaceId}
            onOpenFile={(id) => {
              window.dispatchEvent(
                new CustomEvent<string>("cd:open-file", { detail: id }),
              );
            }}
          />
        )}
        {state.kind === "loading" && <GridSkeleton view={view} />}
        {state.kind === "ready" && total === 0 && contentHits.length === 0 && semanticHits.length === 0 && uploading.length === 0 && (
          <div style={{ marginTop: 24 }}>
            {/* SR12 — when the search came back empty AND there's
                at least one filter to relax, surface the recovery
                panel; otherwise fall back to the registry-motif
                empty-state. computeRelaxations() returns [] when
                nothing's actionable, so we check before rendering. */}
            {inSearchMode ? (
              <NoResultsRecovery
                query={query}
                filters={searchFilters}
                onRelax={(next) => setSearchFilters(next)}
              />
            ) : null}
            {inSearchMode && !hasActiveFilters(searchFilters) ? (
              <EmptyState
                title={`No matches for "${query}"`}
                body="Search covers full document text, not just names."
                illustration="file-search"
                primary={
                  <EmptyStateButton
                    icon={<X size={14} strokeWidth={1.5} />}
                    onClick={() => {
                      setSearchFilters(defaultFilters());
                      window.dispatchEvent(
                        new CustomEvent<string>("cd:search-query", { detail: "" }),
                      );
                    }}
                  >
                    Clear search
                  </EmptyStateButton>
                }
              />
            ) : null}
            {!inSearchMode &&
              (path.length > 1 ? (
                <EmptyState
                  title="This folder is empty"
                  body="Upload a document or create one here. Every version is chained; nothing is ever overwritten."
                  illustration="file-text"
                  primary={
                    <EmptyStateButton
                      icon={<Upload size={14} strokeWidth={1.5} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload
                    </EmptyStateButton>
                  }
                  secondary={
                    <EmptyStateButton
                      variant="ghost"
                      icon={<FolderPlus size={14} strokeWidth={1.5} />}
                      onClick={() => setNewFolderOpen(true)}
                    >
                      New folder
                    </EmptyStateButton>
                  }
                  hint={<span>Drag files anywhere to upload.</span>}
                />
              ) : (
                <EmptyState
                  title="Your locker is empty"
                  body="This is your private, encrypted space. Documents you add here are versioned and hash-chained from the first upload."
                  illustration="lock"
                  primary={
                    <EmptyStateButton
                      icon={<Upload size={14} strokeWidth={1.5} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload documents
                    </EmptyStateButton>
                  }
                  secondary={
                    <EmptyStateButton
                      variant="ghost"
                      icon={<FolderPlus size={14} strokeWidth={1.5} />}
                      onClick={() => setNewFolderOpen(true)}
                    >
                      New folder
                    </EmptyStateButton>
                  }
                  hint={
                    <span>Accepts docx, xlsx, pptx, pdf, md, txt, csv, json, yaml.</span>
                  }
                />
              ))}
          </div>
        )}
        {/* SR-NOTES: in search mode, surface matching notes above the
            files+folders grid. Clicks dispatch the same custom event
            CommandPalette uses, so the Notes tab opens the right page. */}
        {state.kind === "ready" && inSearchMode && (state.notes?.length ?? 0) > 0 && (
          <NoteResultsSection
            notes={state.notes!}
            onOpen={(id) => {
              window.dispatchEvent(
                new CustomEvent<string>("cd:open-note", { detail: id }),
              );
              window.dispatchEvent(
                new CustomEvent<string>("cd:nav", { detail: "notes" }),
              );
            }}
            onCopyLink={(id) => {
              // SR7 remnant — share a deep-link to this specific
              // note. Shell hydrates `?note=<id>` on mount: routes
              // to the Notes tab + fires `cd:open-note`.
              const url = `${window.location.origin}${window.location.pathname}?note=${encodeURIComponent(id)}`;
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("Link copied"))
                  .catch(() => toast.error("Couldn't copy — copy from address bar"));
              } else {
                toast.error("Clipboard isn't available in this browser");
              }
            }}
          />
        )}
        {state.kind === "ready" &&
          (total > 0 || uploading.length > 0) &&
          (view === "grid" ? (
            <GridView
              entries={filteredEntries}
              uploading={uploading}
              selection={selection}
              onEntryClick={(e, entry) => {
                const action = handleEntryClick(e, entry, filteredEntries);
                if (action !== "open") return;
                if (entry.kind === "folder") {
                  enterFolder(entry.folder);
                } else {
                  const i = fileList.findIndex((f) => f.id === entry.file.id);
                  if (i >= 0) handleSingleOrDouble(entry.file, i);
                }
              }}
              onEntryDoubleClick={openInEditorRoute}
              handlersFor={handlersFor}
              drag={dragProps}
            />
          ) : (
            <ListView
              entries={filteredEntries}
              uploading={uploading}
              selection={selection}
              onEntryClick={(e, entry) => {
                const action = handleEntryClick(e, entry, filteredEntries);
                if (action !== "open") return;
                if (entry.kind === "folder") {
                  enterFolder(entry.folder);
                } else {
                  const i = fileList.findIndex((f) => f.id === entry.file.id);
                  if (i >= 0) handleSingleOrDouble(entry.file, i);
                }
              }}
              onEntryDoubleClick={openInEditorRoute}
              onToggleSelect={(entry) => {
                const id = entryId(entry);
                setSelection((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
                setSelectionAnchor(id);
              }}
              handlersFor={handlersFor}
              drag={dragProps}
            />
          ))}
        {/* Content matches — text found INSIDE documents (Phase 3 §2).
            Shown beneath the name/metadata grid so name matches lead. */}
        {state.kind === "ready" && inSearchMode && contentHits.length > 0 && (
          <ContentResultsSection
            hits={contentHits}
            query={query.trim()}
            onOpen={(id) => {
              window.dispatchEvent(
                new CustomEvent<string>("cd:open-file", { detail: id }),
              );
            }}
          />
        )}
        {/* Semantic matches — passages related by MEANING (Phase 5, RAG).
            Shown last: name matches lead, then exact-text, then meaning. */}
        {state.kind === "ready" && inSearchMode && semanticHits.length > 0 && (
          <ContentResultsSection
            hits={semanticHits}
            query={query.trim()}
            label="Related by meaning"
            testId="semantic-results"
            onOpen={(id) => {
              window.dispatchEvent(
                new CustomEvent<string>("cd:open-file", { detail: id }),
              );
            }}
          />
        )}
        {state.kind === "error" && (
          <div style={{ marginTop: 40 }}>
            <EmptyState
              title="Couldn't load files."
              subtitle={state.message}
              tone="alarm"
              role="alert"
              primary={
                <EmptyStateButton
                  icon={<RotateCw size={14} strokeWidth={1.5} />}
                  onClick={() => void refresh()}
                >
                  Try again
                </EmptyStateButton>
              }
            />
          </div>
        )}

        {/* Infinite-scroll sentinel + end-of-results divider. */}
        {inSearchMode && state.kind === "ready" && (
          <>
            {searchMeta?.nextCursor && (
              <div
                ref={loadMoreRef}
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "20px 0 30px",
                  color: "var(--muted)",
                  fontSize: "var(--text-xs)",
                }}
                aria-live="polite"
              >
                {loadingMore ? "Loading more…" : ""}
              </div>
            )}
            {!searchMeta?.nextCursor && total > 0 && (
              <div
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  padding: "20px 0 30px",
                  color: "var(--fg-muted)",
                  fontSize: "var(--text-xs)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                <span style={{ flex: 1, maxWidth: 60, height: 1, background: "var(--border-hair)" }} />
                End of results
                <span style={{ flex: 1, maxWidth: 60, height: 1, background: "var(--border-hair)" }} />
              </div>
            )}
          </>
        )}
      </Stage>

      {dragOver && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--bg-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              padding: "24px 32px",
              border: "3px dashed var(--violet-500)",
              borderRadius: "var(--radius)",
              background: "var(--bg-surface)",
              color: "var(--ink)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <UploadCloud size={28} strokeWidth={2.4} style={{ color: "var(--violet-500)" }} />
            <span style={{ fontSize: "var(--text-md)", fontWeight: 700 }}>
              Drop to upload to {current.name}
            </span>
          </div>
        </div>
      )}

      {(() => {
        // An out-of-pane override (palette / cross-folder open) previews from
        // its own singleton so the grid stays put. Otherwise resolve the id to
        // a live index in the grid each render — if the file was trashed the
        // index is -1 and the modal closes rather than showing whichever file
        // shifted into that slot.
        const overrideActive =
          previewOverride !== null && previewOverride.id === previewId;
        const modalFiles = overrideActive ? [previewOverride] : fileList;
        const previewIndex =
          previewId === null ? -1 : modalFiles.findIndex((f) => f.id === previewId);
        return (
          <PreviewModal
            files={modalFiles}
            index={previewIndex < 0 ? 0 : previewIndex}
            open={previewIndex >= 0}
            onClose={() => {
              setPreviewId(null);
              setPreviewOverride(null);
            }}
            onChangeIndex={(i) => setPreviewId(modalFiles[i]?.id ?? null)}
          />
        );
      })()}

      {renaming && (
        <RenameDialog
          open
          current={renaming.kind === "folder" ? renaming.folder.name : renaming.file.name}
          label={renaming.kind === "folder" ? "Folder" : "File"}
          onClose={() => setRenaming(null)}
          onSubmit={async (newName) => {
            if (renaming.kind === "folder") {
              await api.renameFolder(renaming.folder.id, newName);
            } else {
              await api.renameFile(renaming.file.id, newName);
            }
            toast.success("Renamed");
            void refresh();
          }}
        />
      )}

      <ShareDialog open={sharing !== null} file={sharing} onClose={() => setSharing(null)} />

      {selection.size > 0 && (
        <SelectionBar
          count={selection.size}
          onClear={() => setSelection(new Set())}
          onDownload={bulkDownload}
          onTrash={bulkTrash}
        />
      )}

      <PromptDialog
        open={newFolderOpen}
        title="New folder"
        label="Name"
        placeholder="Untitled folder"
        defaultValue="Untitled folder"
        submitLabel="Create folder"
        validate={(v) => {
          if (v.length < 1) return "Required";
          if (v.length > 200) return "Name is too long";
          if (/[\/\\\0]/.test(v)) return "Slashes and null bytes aren't allowed";
          return null;
        }}
        onSubmit={async (name) => {
          try {
            await api.createFolder(name, current.id, workspaceId);
            toast.success("Folder created");
            void refresh();
          } catch {
            toast.error("Couldn't create folder");
          }
        }}
        onClose={() => setNewFolderOpen(false)}
      />
    </div>
  );
}

/** Content matches — text found INSIDE documents (Phase 3 §2). Each row
 *  shows the document title + a highlighted snippet of the matching text.
 *  Neobrutalist rows: 2px ink border, hard offset shadow, violet highlight
 *  on the matched terms (via SearchSnippet). */
function ContentResultsSection({
  hits,
  query,
  onOpen,
  label = "In documents",
  testId = "content-results",
}: {
  /** Minimal shape shared by ContentHit + SemanticHit. */
  hits: Array<{ file_id: string; title: string; snippet: string }>;
  query: string;
  onOpen: (fileId: string) => void;
  label?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      style={{ marginTop: 18, marginBottom: 18 }}
    >
      <h2
        style={{
          margin: "8px 0 8px",
          fontSize: "var(--text-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </h2>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 6,
        }}
      >
        {hits.map((h) => (
          <li key={h.file_id} style={{ position: "relative" }}>
            <button
              type="button"
              data-testid="content-result-row"
              className="press-sink"
              onClick={() => onOpen(h.file_id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                cursor: "pointer",
                border: "var(--border-w) solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-surface)",
                boxShadow: "var(--shadow-sm)",
                padding: "10px 12px",
                color: "var(--fg-default)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <FileText
                  size={14}
                  strokeWidth={1.8}
                  style={{ flexShrink: 0, color: "var(--fg-muted)" }}
                  aria-hidden="true"
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.title}
                </span>
              </span>
              <SearchSnippet snippet={h.snippet} query={query} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NoteResultsSection({
  notes,
  onOpen,
  onCopyLink,
}: {
  notes: NoteSearchHit[];
  onOpen: (id: string) => void;
  /** SR7 remnant — note hits gain a "Copy link" kebab action so users
   * can share a deep-link to a specific note. Bounded scope; full
   * rename / move / trash routing through the Notes tab UI. */
  onCopyLink: (id: string) => void;
}) {
  return (
    <section aria-label="Note results" style={{ marginBottom: 18 }}>
      <h2
        style={{
          margin: "8px 0 8px",
          fontSize: "var(--text-xs)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontWeight: 600,
        }}
      >
        Notes
      </h2>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 4,
        }}
      >
        {notes.map((n) => (
          <NoteResultRow
            key={n.id}
            note={n}
            onOpen={() => onOpen(n.id)}
            onCopyLink={() => onCopyLink(n.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function NoteResultRow({
  note,
  onOpen,
  onCopyLink,
}: {
  note: NoteSearchHit;
  onOpen: () => void;
  onCopyLink: () => void;
}) {
  return (
    <li style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 40px 8px 10px",
          borderRadius: 8,
          background: "transparent",
          border: "1px solid var(--line)",
          color: "var(--ink)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          transition: "background 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.borderColor = "var(--line-strong)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "var(--line)";
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "var(--bg-subtle)",
            color: "var(--muted)",
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          ¶
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>{note.title}</span>
        <span style={{ fontSize: 11, color: "var(--muted-2)" }}>Open in Notes →</span>
      </button>
      <NoteResultKebab onCopyLink={onCopyLink} />
    </li>
  );
}

function NoteResultKebab({ onCopyLink }: { onCopyLink: () => void }) {
  // Matches the discoverability pattern from file / list rows — kebab
  // sits at 0.55 opacity by default (never invisible) and brightens
  // on row hover or focus. Same Radix DropdownMenu primitives + token
  // styles the SortMenu / EntryKebab use, so a future "Rename" /
  // "Trash" addition slots in without reshaping the surface.
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Note actions"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "50%",
            right: 8,
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            opacity: 0.55,
            borderRadius: 6,
            cursor: "pointer",
            transition: "opacity 180ms, background 150ms, color 150ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = "1";
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--ink)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = "0.55";
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--muted)";
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          style={{
            minWidth: 160,
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-lg)",
            padding: 6,
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            color: "var(--ink)",
            zIndex: 60,
            animation: "cd-popover-in 160ms var(--ease)",
          }}
        >
          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              onCopyLink();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 10px",
              borderRadius: 8,
              cursor: "pointer",
              userSelect: "none",
              outline: "none",
              transition: "background 120ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Link2 size={13} strokeWidth={1.8} aria-hidden="true" />
            Copy link
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        animation: "cd-stage 420ms var(--ease)",
      }}
    >
      {children}
      <style>
        {`
          @keyframes cd-stage {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}

function Header({
  path,
  searching,
  count,
  contentCount = 0,
  searchTotals,
  onBack,
  onJumpTo,
  sort,
  onSortChange,
  showSort,
  drag,
}: {
  path: Crumb[];
  searching: boolean;
  count: number;
  /** Content (in-document) match count — folded into the search subtitle so
   * it never reads "No matches" while content hits are listed below. */
  contentCount?: number;
  /** When present (search mode), drives the per-kind count chip
   * ("142 files · 6 folders · 3 notes"). */
  searchTotals?: { files: number; folders: number; notes: number; exact: boolean };
  onBack: () => void;
  onJumpTo: (idx: number) => void;
  sort: { key: SortKey; dir: SortDir };
  onSortChange: (key: SortKey, dir: SortDir) => void;
  showSort: boolean;
  drag?: DragProps;
}) {
  const deep = path.length > 1;
  const current = path[path.length - 1];

  return (
    <div className="cd-files-header" style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 30 }}>
      {deep && (
        <button
          type="button"
          aria-label="Back"
          title="Back (Backspace)"
          onClick={onBack}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--card)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ink)",
            flexShrink: 0,
            marginBottom: 2,
            transition: "background 150ms, transform 150ms",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.transform = "translateX(-2px)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--card)";
            e.currentTarget.style.transform = "";
          }}
        >
          <ChevronLeft size={17} strokeWidth={2} />
        </button>
      )}

      <div style={{ flex: 1 }}>
        {/* Breadcrumbs */}
        {deep && !searching && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: "var(--text-sm)",
              color: "var(--muted)",
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            {path.slice(0, -1).map((c, i) => (
              <CrumbButton
                key={i}
                label={c.name}
                onClick={() => onJumpTo(i)}
                sep
                dropActive={drag ? drag.dropTargetId === (c.id ?? CRUMB_ROOT_KEY) : false}
                onDragOver={drag ? (e) => drag.onCrumbDragOver(c.id, e) : undefined}
                onDragLeave={drag ? () => drag.onCrumbDragLeave(c.id) : undefined}
                onDrop={drag ? (e) => drag.onCrumbDrop(c.id, e) : undefined}
              />
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1
            className="cd-files-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-3xl)",
              fontWeight: 700,
              letterSpacing: "var(--tracking-display-md)",
              color: "var(--ink)",
            }}
          >
            {searching ? "Search results" : current.name}
          </h1>
          {searching ? (
            <span
              aria-live="polite"
              style={{ fontSize: "var(--text-sm)", color: "var(--muted)", paddingBottom: 4 }}
            >
              {formatSearchTotals(searchTotals, contentCount)}
            </span>
          ) : (
            count > 0 && (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)", paddingBottom: 4 }}>
                {count} {count === 1 ? "item" : "items"}
              </span>
            )
          )}
        </div>
      </div>

      {showSort && (
        <div style={{ paddingBottom: 4, flexShrink: 0 }}>
          <SortMenu sortKey={sort.key} sortDir={sort.dir} onChange={onSortChange} />
        </div>
      )}
    </div>
  );
}

function formatSearchTotals(
  t: { files: number; folders: number; notes: number; exact: boolean } | undefined,
  contentCount: number,
): string {
  const parts: string[] = [];
  if (t) {
    if (t.files > 0) parts.push(`${t.files} ${t.files === 1 ? "file" : "files"}`);
    if (t.folders > 0) parts.push(`${t.folders} ${t.folders === 1 ? "folder" : "folders"}`);
    if (t.notes > 0) parts.push(`${t.notes} ${t.notes === 1 ? "note" : "notes"}`);
  }
  if (contentCount > 0) {
    parts.push(`${contentCount} in ${contentCount === 1 ? "document" : "documents"}`);
  }
  if (parts.length === 0) return "No matches";
  const body = parts.join(" · ");
  return t && !t.exact ? `${body} (more)` : body;
}

function CrumbButton({
  label,
  onClick,
  sep,
  dropActive,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  onClick: () => void;
  sep?: boolean;
  dropActive?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          border: dropActive ? "1px solid var(--violet-500)" : "none",
          background: dropActive ? "var(--bg-hover)" : "transparent",
          cursor: "pointer",
          color: dropActive ? "var(--ink)" : "var(--muted)",
          fontSize: "var(--text-sm)",
          padding: dropActive ? "2px 4px" : "3px 5px",
          borderRadius: 7,
          transition: "background 150ms, color 150ms",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--ink)";
        }}
        onMouseOut={(e) => {
          if (dropActive) return;
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--muted)";
        }}
      >
        {label}
      </button>
      {sep && <ChevronRightSeparator size={13} style={{ color: "var(--muted-2)" }} />}
    </>
  );
}

// ─── Document identity (vault surface only) ──────────────────────────
// Kills the blank white 96px thumbnail (defect #3 / P1). Every doc + folder
// gets a per-file-type gradient cover FIELD + a colored, modeled glyph TILE
// (type-tinted ink drop shadow + top rim-light = carved depth) so a PDF, a
// Sheet and a Doc are instantly distinguishable at a glance. File-type
// chroma lives HERE, on the vault surface — not in the monochrome
// foundation tokens. Hues read on both the Registry (dark) and Reading Room
// (light) grounds; folder + ink types resolve through theme tokens.
// Neobrutalist type-cover colors (ui-system-neobrutal §5 / spec §2). Flat,
// bold, vivid; the folder resolves to the violet signal. Fixed hexes read on
// both the Paper (light) and Ink (dark) grounds — each cover is a solid fill
// with a white glyph inside a 2px ink border.
const KIND_HUE: Record<FileKind, string> = {
  fold:    "#8B5CF6", // violet — folder
  doc:     "#2563EB", // blue  — docx
  sheet:   "#16A34A", // green — xlsx
  pdf:     "#DC2626", // red   — pdf
  md:      "#14110C", // ink   — markdown
  text:    "#14110C", // ink   — txt / csv / json / yaml / source
  generic: "#14110C", // ink   — unknown document
  img:     "#0891B2", // cyan  — image preview fallback
  vid:     "#0891B2",
  aud:     "#8B5CF6",
};

const KIND_GLYPH: Record<FileKind, LucideIcon> = {
  fold: FolderIcon,
  doc: FileText,
  sheet: FileSpreadsheet,
  pdf: FileText,
  md: FileText,
  text: FileText,
  generic: FileGeneric,
  img: FileImage,
  vid: FileImage,
  aud: FileGeneric,
};

/** Per-type FLAT cover band + big glyph (ui-system-neobrutal §5). Replaces
 * the old blank FileThumb "paper" for the vault grid — never a blank
 * thumbnail. A real image preview still wins when a thumbnail is present. */
function DocCover({
  name,
  kind,
  thumbnail,
  thumbUrls,
}: {
  name: string;
  kind: FileKind;
  thumbnail?: string | null;
  thumbUrls?: { small: string; medium: string; large: string } | null;
}) {
  const effectiveThumb = (thumbUrls && thumbUrls.medium) ?? thumbnail ?? null;

  // A real image preview always wins over the procedural cover.
  if (kind === "img" && effectiveThumb) {
    return (
      <div
        role="img"
        aria-label={`Preview of ${name}`}
        style={{
          width: "100%",
          height: "100%",
          backgroundImage: `url(${JSON.stringify(effectiveThumb)})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
    );
  }

  const hue = KIND_HUE[kind] ?? "#14110C";
  const Icon = KIND_GLYPH[kind] ?? FileGeneric;

  // Neobrutalist cover band — a FLAT solid type-color fill (no gradient, no
  // blur) with a big bold glyph and a large corner-anchored watermark glyph
  // for texture. Every type is instantly distinguishable at a glance; there
  // is never a blank thumbnail. The bottom 2px ink rule separates the band
  // from the meta row (the card supplies the outer border).
  return (
    <div
      aria-hidden={kind !== "fold"}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hue,
        overflow: "hidden",
      }}
    >
      {/* Oversized watermark glyph — flat, corner-anchored field texture. */}
      <Icon
        size={116}
        strokeWidth={1.6}
        style={{
          position: "absolute",
          right: -22,
          bottom: -30,
          color: "#FFFFFF",
          opacity: 0.16,
          pointerEvents: "none",
        }}
      />
      {/* The identity glyph — big, bold, white on the type color. */}
      <Icon
        className="cd-cover-tile"
        size={40}
        strokeWidth={2.2}
        color="#FFFFFF"
        style={{
          position: "relative",
          transition: "transform var(--dur) var(--ease)",
        }}
      />
    </div>
  );
}

/** Compact status pill for a grid card. Sealed (chained, version > 1) reads
 * amber; a broken chain is the sole tamper alarm (danger); everything else
 * is a quiet "Draft". Icon + label always — never colour-only. */
function CardStatusPill({
  sealed,
  version,
  chainVerified,
}: {
  sealed: boolean;
  version: number | null;
  chainVerified?: boolean;
}) {
  const tampered = chainVerified === false;
  // Neobrutalist chip (§5): solid/tinted fill + 2px border, icon + label
  // always. SEALED/verified = violet, tamper = danger, draft = quiet sunken.
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 7px",
    borderRadius: "var(--radius-xs)",
    border: "var(--border-w) solid var(--border)",
    fontSize: "var(--text-2xs)",
    fontWeight: "var(--weight-bold)",
    lineHeight: 1,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  };
  if (tampered) {
    return (
      <span
        style={{
          ...base,
          color: "#FFFFFF",
          background: "var(--danger)",
        }}
      >
        <ShieldAlert size={11} strokeWidth={2.4} aria-hidden />
        Tamper
      </span>
    );
  }
  if (sealed) {
    return (
      <span
        title="Hash-chain sealed — tamper-evident"
        style={{
          ...base,
          color: "var(--violet-600)",
          background: "var(--violet-100)",
        }}
      >
        <ShieldCheck size={11} strokeWidth={2.4} aria-hidden />
        Sealed{version !== null ? ` · v${version}` : ""}
      </span>
    );
  }
  return (
    <span
      style={{
        ...base,
        color: "var(--ink-soft)",
        background: "var(--bg-sunken)",
      }}
    >
      Draft
    </span>
  );
}

// ─── Views ───────────────────────────────────────────────────────────

/** Sentinel `dropTargetId` for the root ("My Drive") breadcrumb — real folders
 * carry ULIDs, so this never collides. */
const CRUMB_ROOT_KEY = " crumb-root";

type DragProps = {
  onEntryDragStart: (entry: Entry, e: React.DragEvent) => void;
  onEntryDragEnd: () => void;
  onFolderDragOver: (folderId: string, e: React.DragEvent) => void;
  onFolderDragLeave: (folderId: string) => void;
  onFolderDrop: (folderId: string, e: React.DragEvent) => void;
  /** Breadcrumb crumbs are move targets too — `null` id is the root. */
  onCrumbDragOver: (crumbId: string | null, e: React.DragEvent) => void;
  onCrumbDragLeave: (crumbId: string | null) => void;
  onCrumbDrop: (crumbId: string | null, e: React.DragEvent) => void;
  dropTargetId: string | null;
};

function GridView({
  entries,
  uploading,
  selection,
  onEntryClick,
  onEntryDoubleClick,
  handlersFor,
  drag,
}: {
  entries: Entry[];
  uploading: string[];
  selection: Set<string>;
  onEntryClick: (e: React.MouseEvent, entry: Entry) => void;
  onEntryDoubleClick?: (entry: Entry) => void;
  handlersFor: (entry: MenuEntry) => EntryMenuHandlers;
  drag?: DragProps;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "var(--files-grid)",
        gap: 16,
      }}
    >
      {entries.map((e) =>
        e.kind === "folder" ? (
          <FolderCard
            key={e.folder.id}
            folder={e.folder}
            selected={selection.has(e.folder.id)}
            onClick={(ev) => onEntryClick(ev, e)}
            onDoubleClick={onEntryDoubleClick ? () => onEntryDoubleClick(e) : undefined}
            handlers={handlersFor(e)}
            draggable={!!drag}
            dropTarget={drag?.dropTargetId === e.folder.id}
            onDragStart={drag ? (ev) => drag.onEntryDragStart(e, ev) : undefined}
            onDragEnd={drag?.onEntryDragEnd}
            onDragOver={drag ? (ev) => drag.onFolderDragOver(e.folder.id, ev) : undefined}
            onDragLeave={drag ? () => drag.onFolderDragLeave(e.folder.id) : undefined}
            onDrop={drag ? (ev) => drag.onFolderDrop(e.folder.id, ev) : undefined}
          />
        ) : (
          <FileCard
            key={e.file.id}
            file={e.file}
            selected={selection.has(e.file.id)}
            onClick={(ev) => onEntryClick(ev, e)}
            onDoubleClick={onEntryDoubleClick ? () => onEntryDoubleClick(e) : undefined}
            handlers={handlersFor(e)}
            draggable={!!drag}
            onDragStart={drag ? (ev) => drag.onEntryDragStart(e, ev) : undefined}
            onDragEnd={drag?.onEntryDragEnd}
          />
        ),
      )}
      {uploading.map((name) => (
        <GhostCard key={name} name={name} />
      ))}
    </div>
  );
}

function FolderCard({
  folder,
  selected,
  onClick,
  onDoubleClick,
  handlers,
  draggable,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: FolderDto;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  handlers: EntryMenuHandlers;
  draggable?: boolean;
  dropTarget?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <EntryContextMenu entry={{ kind: "folder", folder }} handlers={handlers}>
      <Card
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        folder
        selected={selected}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={
          dropTarget
            ? { outline: "2px solid var(--violet-500)", outlineOffset: 2 }
            : undefined
        }
        kebab={<EntryKebab entry={{ kind: "folder", folder }} handlers={handlers} />}
      >
        <div
          style={{
            height: "var(--cd-card-thumb-h)",
            overflow: "hidden",
            borderBottom: "var(--border-w) solid var(--border)",
          }}
        >
          <DocCover name={folder.name} kind="fold" />
        </div>
        <CardMeta name={folder.name} kind="fold" sub={`Folder · ${relative(folder.modified_at)}`} />
      </Card>
    </EntryContextMenu>
  );
}

function FileCard({
  file,
  selected,
  onClick,
  onDoubleClick,
  handlers,
  draggable,
  onDragStart,
  onDragEnd,
}: {
  file: FileDto;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  handlers: EntryMenuHandlers;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const kind = inferKind(file.name, file.content_type);
  const version = file.version ?? null;
  // Sealed = a committed, hash-chained document worth flagging (matches the
  // list view's `showVersion` gate: version > 1). Verification is spatial
  // identity here — an amber left rule + top-bar + pill, never a loud badge.
  const sealed = version !== null && version > 1;
  const chainVerified = readChainVerified(file);
  return (
    <EntryContextMenu entry={{ kind: "file", file }} handlers={handlers}>
      <Card
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        selected={selected}
        sealed={sealed}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        kebab={<EntryKebab entry={{ kind: "file", file }} handlers={handlers} />}
      >
        <div
          style={{
            height: "var(--cd-card-thumb-h)",
            overflow: "hidden",
            borderBottom: "var(--border-w) solid var(--border)",
            position: "relative",
          }}
        >
          {/* RT3 — peer-viewing dot. Renders null when no one else
              is viewing this file; tinted with that peer's avatar
              colour when they are. */}
          <FileViewingDot fileId={file.id} placement="card" />
          <DocCover
            name={file.name}
            kind={kind}
            thumbnail={file.thumbnail}
            thumbUrls={file.thumb_urls}
          />
        </div>
        <CardMeta
          name={file.name}
          kind={kind}
          sealed={sealed}
          version={version}
          chainVerified={chainVerified}
          trailing={sealed ? `v${version}` : relative(file.modified_at)}
        />
      </Card>
    </EntryContextMenu>
  );
}

function GhostCard({ name }: { name: string }) {
  return (
    <Card>
      <div
        style={{
          height: "var(--cd-card-thumb-h)",
          borderBottom: "var(--border-w) solid var(--border)",
          background: "var(--violet-500)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <UploadCloud size={40} strokeWidth={2.2} color="#FFFFFF" />
      </div>
      <CardMeta name={name} kind="generic" sub="Uploading…" />
    </Card>
  );
}

// `Card` is a Radix `asChild` consumer (the `<EntryContextMenu>` wraps
// every card with a `ContextMenu.Trigger asChild`). For that to work,
// Card MUST forward refs AND spread arbitrary props through to the
// underlying <div> — otherwise Radix's injected `onContextMenu` and
// `ref` get dropped on the floor and right-click does nothing. This is
// what BUG-RIGHT-CLICK turned out to be post-reskin: the surface
// refactor lost the `...rest` spread.
const Card = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    folder?: boolean;
    kebab?: React.ReactNode;
    selected?: boolean;
    /** Sealed docs carry a 3px amber left rule (verification as spatial
     * identity, §5.2). Pairs with the cover's amber top-bar. */
    sealed?: boolean;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "children">
>(function Card({ children, onClick, folder, kebab, selected, sealed, ...rest }, ref) {
  // Neobrutalist tile (§5): flat surface, hard 2px ink border, hard offset
  // shadow. Hover RAISES (translate -1,-1 + shadow grows to lg); press SINKS
  // into the shadow (translate 2,2 + shadow shrinks to sm). Selection swaps
  // the fill to violet-100 and thickens the border shadow to violet.
  const restShadow = "var(--shadow)";
  const hoverShadow = "var(--shadow-lg)";
  const pressShadow = "var(--shadow-sm)";
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={folder ? "cd-folder-card" : "cd-file-card"}
      {...rest}
      style={{
        background: selected ? "var(--violet-100)" : "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition:
          "transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
        boxShadow: restShadow,
        position: "relative",
        userSelect: "none",
        ...(rest.style ?? {}),
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "var(--lift)";
        e.currentTarget.style.boxShadow = hoverShadow;
        const tile = e.currentTarget.querySelector<HTMLElement>(".cd-cover-tile");
        if (tile) tile.style.transform = "scale(1.12)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = restShadow;
        const tile = e.currentTarget.querySelector<HTMLElement>(".cd-cover-tile");
        if (tile) tile.style.transform = "";
      }}
      onMouseDown={(e) => {
        // The Press — the whole tile sinks into its offset shadow.
        e.currentTarget.style.transform = "var(--lift-press)";
        e.currentTarget.style.boxShadow = pressShadow;
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "var(--lift)";
        e.currentTarget.style.boxShadow = hoverShadow;
      }}
    >
      {/* Sealed — 4px violet left rule spanning the whole card. */}
      {sealed && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 4,
            background: "var(--violet-500)",
            borderRight: "2px solid var(--border)",
            zIndex: 2,
          }}
        />
      )}
      {children}
      {kebab && (
        <span
          className="cd-card-kebab"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            /* Always visible at a subtle 0.55 so the affordance is
             * discoverable; brightens to 1 on card hover. Previously
             * opacity:0 by default made users believe the menu didn't
             * exist (and right-click was the only other path). */
            opacity: 0.55,
            transform: "translateY(0)",
            transition: "opacity 180ms",
          }}
        >
          {kebab}
        </span>
      )}
      {folder && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "var(--card)",
            border: "1px solid var(--line-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0,
            transform: "translateX(4px)",
            transition: "opacity 200ms, transform 200ms",
            pointerEvents: "none",
          }}
          className="cd-open-hint"
        >
          <ChevronRightSeparator size={13} style={{ color: "var(--ink)" }} />
        </span>
      )}
      <style>{`
        .cd-folder-card:hover .cd-open-hint,
        .cd-folder-card:hover .cd-card-kebab,
        .cd-file-card:hover .cd-card-kebab {
          opacity: 1;
          transform: translateX(0) translateY(0);
        }
        /* Keyboard users — the kebab button itself getting focus also
         * lights it up so the menu is reachable via Tab. */
        .cd-card-kebab:focus-within {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
});

function CardMeta({
  name,
  kind,
  sub,
  sealed,
  version,
  chainVerified,
  trailing,
}: {
  name: string;
  kind: FileKind;
  /** Folder / ghost cards render this plain sub-line instead of a pill row. */
  sub?: string;
  sealed?: boolean;
  version?: number | null;
  chainVerified?: boolean;
  /** File cards: right-aligned mono tail — the version tag when sealed, else
   * the relative modified time. */
  trailing?: string;
}) {
  const isFolder = kind === "fold";
  const glyphColor = isFolder ? "var(--accent)" : (KIND_HUE[kind] ?? "#7C7E8A");
  const Glyph = KIND_GLYPH[kind] ?? FileGeneric;
  return (
    <div style={{ padding: "var(--cd-card-meta-pad-y) var(--cd-card-meta-pad-x)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Glyph size={15} strokeWidth={1.8} style={{ color: glyphColor, flexShrink: 0 }} aria-hidden />
        <span
          style={{
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-medium)",
            color: "var(--fg-default)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
      </div>
      {sub !== undefined ? (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--fg-muted)",
            marginTop: 7,
          }}
        >
          {sub}
        </div>
      ) : (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <CardStatusPill sealed={!!sealed} version={version ?? null} chainVerified={chainVerified} />
          {trailing && (
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "var(--mono-xs)",
                color: "var(--fg-subtle)",
                whiteSpace: "nowrap",
              }}
            >
              {trailing}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ListView({
  entries,
  uploading,
  selection,
  onEntryClick,
  onEntryDoubleClick,
  onToggleSelect,
  handlersFor,
  drag,
}: {
  entries: Entry[];
  uploading: string[];
  selection: Set<string>;
  onEntryClick: (e: React.MouseEvent, entry: Entry) => void;
  onEntryDoubleClick?: (entry: Entry) => void;
  onToggleSelect: (entry: Entry) => void;
  handlersFor: (entry: MenuEntry) => EntryMenuHandlers;
  drag?: DragProps;
}) {
  return (
    <div
      role="table"
      aria-label="Documents"
      className="glass"
      style={{
        overflow: "hidden",
      }}
    >
      <VaultHeader />
      {entries.map((e, i) => {
        const last = i === entries.length - 1 && uploading.length === 0;
        if (e.kind === "folder") {
          const entry: MenuEntry = { kind: "folder", folder: e.folder };
          const handlers = handlersFor(entry);
          return (
            <EntryContextMenu key={e.folder.id} entry={entry} handlers={handlers}>
              <VaultRow
                name={e.folder.name}
                kind="fold"
                version={null}
                modified={relative(e.folder.modified_at)}
                last={last}
                selected={selection.has(e.folder.id)}
                onClick={(ev) => onEntryClick(ev, e)}
                onDoubleClick={onEntryDoubleClick ? () => onEntryDoubleClick(e) : undefined}
                onToggle={() => onToggleSelect(e)}
                kebab={<EntryKebab entry={entry} handlers={handlers} />}
                draggable={!!drag}
                dropActive={drag?.dropTargetId === e.folder.id}
                onDragStart={drag ? (ev) => drag.onEntryDragStart(e, ev) : undefined}
                onDragEnd={drag?.onEntryDragEnd}
                onDragOver={drag ? (ev) => drag.onFolderDragOver(e.folder.id, ev) : undefined}
                onDragLeave={drag ? () => drag.onFolderDragLeave(e.folder.id) : undefined}
                onDrop={drag ? (ev) => drag.onFolderDrop(e.folder.id, ev) : undefined}
              />
            </EntryContextMenu>
          );
        }
        const kind = inferKind(e.file.name, e.file.content_type);
        const entry: MenuEntry = { kind: "file", file: e.file };
        const handlers = handlersFor(entry);
        return (
          <EntryContextMenu key={e.file.id} entry={entry} handlers={handlers}>
            <VaultRow
              fileId={e.file.id}
              name={e.file.name}
              kind={kind}
              version={e.file.version}
              modified={relative(e.file.modified_at)}
              size={e.file.size}
              status={e.file.status}
              chainVerified={readChainVerified(e.file)}
              selected={selection.has(e.file.id)}
              onClick={(ev) => onEntryClick(ev, e)}
              onDoubleClick={onEntryDoubleClick ? () => onEntryDoubleClick(e) : undefined}
              onToggle={() => onToggleSelect(e)}
              last={last}
              kebab={<EntryKebab entry={entry} handlers={handlers} />}
              draggable={!!drag}
              onDragStart={drag ? (ev) => drag.onEntryDragStart(e, ev) : undefined}
              onDragEnd={drag?.onEntryDragEnd}
            />
          </EntryContextMenu>
        );
      })}
      {uploading.map((name) => (
        <VaultRow
          key={name}
          name={name}
          kind="generic"
          version={null}
          modified=""
          status="uploading"
          ghost
          last
        />
      ))}
      <style>{`
        [data-density="compact"] .cd-vault-row { height: 28px; }
        .cd-vault-row:hover { background: var(--bg-hover); }
        /* Actions rest hidden and fade in on hover/focus (§2.2 "actions
           fade in right"). Kept in CSS — not an inline opacity — so the
           :hover / :focus-within rules can actually win. */
        .cd-vault-kebab { opacity: 0; transition: opacity var(--dur-base); }
        .cd-vault-row:hover .cd-vault-kebab,
        .cd-vault-row:focus-within .cd-vault-kebab { opacity: 1; }
        .cd-vault-row:hover .cd-vault-select,
        .cd-vault-row:focus-within .cd-vault-select { opacity: 1; }
      `}</style>
    </div>
  );
}

/** Dense vault table header — 36px, sticky under the toolbar. Numeric
 * columns are right-hairline aligned per ui-system. */
function VaultHeader() {
  const cell: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div
      role="row"
      className="glass--thin"
      style={{
        display: "grid",
        gridTemplateColumns: VAULT_GRID,
        alignItems: "center",
        height: 36,
        padding: "0 var(--space-3)",
        gap: "var(--space-3)",
        position: "sticky",
        top: 0,
        zIndex: 1,
        borderBottom: "var(--border-w) solid var(--border)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-semibold)",
        color: "var(--fg-muted)",
      }}
    >
      <span aria-hidden />
      <span style={cell}>Name</span>
      <span className="cd-col-version" style={cell}>Version</span>
      <span style={cell}>Status</span>
      <span className="cd-col-updated" style={cell}>Updated</span>
      <span className="cd-col-size" style={{ ...cell, textAlign: "right" }}>Size</span>
    </div>
  );
}

// Same `asChild` forwardRef contract as `Card` — without it the
// row's right-click context menu silently no-ops.
const VaultRow = React.forwardRef<
  HTMLDivElement,
  {
    /** Only file rows carry it; the upload-ghost row has no id yet. */
    fileId?: string;
    name: string;
    kind: FileKind;
    version: number | null;
    modified: string;
    /** Byte size — file rows only; folders/ghosts leave it undefined. */
    size?: number;
    status?: "uploading" | "ready" | "failed";
    /** Hash-chain verification state (§2.3 compliance cue). `false` is the
     * only tamper alarm; `undefined`/`true` read as verified. */
    chainVerified?: boolean;
    onClick?: (e: React.MouseEvent) => void;
    onDoubleClick?: () => void;
    onToggle?: () => void;
    last?: boolean;
    ghost?: boolean;
    kebab?: React.ReactNode;
    selected?: boolean;
    /** Folder rows only — lit while a dragged entry hovers as a move target. */
    dropActive?: boolean;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "onDoubleClick">
>(function VaultRow(
  {
    fileId,
    name,
    kind,
    version,
    modified,
    size,
    status,
    chainVerified,
    onClick,
    onDoubleClick,
    onToggle,
    last,
    ghost,
    kebab,
    selected,
    dropActive,
    ...rest
  },
  ref,
) {
  const Icon = kindIconFor(kind);
  const uploading = status === "uploading";
  // Compliance cue + size render for real document rows only — folders
  // and the upload-ghost placeholder carry neither.
  const isFile = kind !== "fold" && !ghost;
  // M6 — Version is compliance-conditional: only surface `v{n}` when the
  // document has an append-only chain worth flagging (versions > 1). The
  // cell stays present (empty) otherwise so the grid template holds.
  const showVersion = version !== null && version !== undefined && version > 1;
  const cell: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div
      ref={ref}
      role="row"
      tabIndex={ghost ? undefined : 0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onDoubleClick) {
          e.preventDefault();
          onDoubleClick();
        }
      }}
      className="cd-vault-row glass--thick"
      {...rest}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: VAULT_GRID,
        alignItems: "center",
        height: 32,
        padding: "0 var(--space-3)",
        gap: "var(--space-3)",
        cursor: onClick ? "pointer" : "default",
        borderBottom: last ? "none" : "var(--border-w) solid var(--border)",
        opacity: ghost ? 0.6 : 1,
        // Near-solid glass rows (legibility); selected wins with an
        // amber wash + left rule. Leaving background undefined lets the
        // `.glass--thick` material own the resting fill.
        background: selected ? "var(--bg-selected)" : undefined,
        boxShadow: selected ? "inset 2px 0 0 var(--accent)" : "none",
        userSelect: "none",
        outline: dropActive ? "2px solid var(--violet-500)" : undefined,
        outlineOffset: -2,
      }}
    >
      {/* Select */}
      <span
        className="cd-vault-select"
        style={{ display: "flex", alignItems: "center", opacity: selected ? 1 : 0 }}
      >
        {!ghost && (
          <input
            type="checkbox"
            checked={!!selected}
            aria-label={`Select ${name}`}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle?.()}
            style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
          />
        )}
      </span>

      {/* Name */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        {ghost || uploading ? (
          <UploadCloud size={16} strokeWidth={1.5} style={{ color: "var(--accent)", flexShrink: 0 }} />
        ) : (
          <Icon size={16} strokeWidth={1.5} style={{ color: "var(--fg-muted)", flexShrink: 0 }} />
        )}
        {fileId && <FileViewingDot fileId={fileId} placement="list" />}
        <span
          style={{
            ...cell,
            fontSize: "var(--text-base)",
            fontWeight: "var(--weight-medium)",
            color: "var(--fg-default)",
          }}
        >
          {name}
        </span>
      </div>

      {/* Version — compliance-conditional (empty when versions ≤ 1) */}
      <span className="mono cd-col-version" style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
        {showVersion ? `v${version}` : ""}
      </span>

      {/* Status — the row's compliance payload (§2.3). Files only. */}
      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        {isFile && <VaultStatusPill chainVerified={chainVerified} />}
      </span>

      {/* Updated */}
      <span className="cd-col-updated" style={{ ...cell, fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
        {modified}
      </span>

      {/* Size — right-hairline-aligned numeric (ui-system). */}
      <span
        className="tnum cd-col-size"
        style={{ ...cell, textAlign: "right", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}
      >
        {isFile && size !== undefined ? formatSize(size) : ""}
      </span>

      {/* Actions — overlaid on the right edge, fade in on hover/focus
          (§2.2). Not a grid track, so it never steals column width; the
          `.cd-vault-kebab` opacity lives in the ListView <style> block so
          the hover/focus rule can win (an inline opacity can't be
          overridden by a stylesheet :hover rule). */}
      {kebab && (
        <span
          className="cd-vault-kebab"
          style={{
            position: "absolute",
            top: "50%",
            right: "var(--space-3)",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {kebab}
        </span>
      )}
    </div>
  );
});

/** Dense compliance cue for a vault row (ui-redesign-v3 §2.3). Encryption
 * is universal (AES-256-GCM), so every document is `encrypted`; the
 * hash-chain verify state rides alongside it in the same pill. A
 * `chain_verified === false` is the sole tamper alarm — `undefined`/`true`
 * read as verified (the quiet default, matching Activity.tsx's handling of
 * the same field). Icon + label always, never colour-only; tamper adds an
 * `--accent-glow` alarm.
 *
 * FOLLOW-UP: the full status cluster in the spec also carries `gavel`
 * (legal hold) and `badge-check` (signed) states — those need backend
 * FileDto fields (`held` / `requires_signature` / `retention_due`) that
 * the wire shape doesn't expose yet, so they're intentionally omitted
 * here rather than fabricated. Extend this pill when they land. */
function VaultStatusPill({ chainVerified }: { chainVerified?: boolean }) {
  const tampered = chainVerified === false;
  const label = tampered ? "Tamper" : "Verified";
  const Shield = tampered ? ShieldAlert : ShieldCheck;
  const fg = tampered ? "var(--status-danger-700)" : "var(--status-verified-700)";
  const iconColor = tampered ? "var(--status-danger)" : "var(--status-verified)";
  return (
    <span
      className="glass--ultrathin"
      title={
        tampered
          ? "Encrypted (AES-256-GCM) · hash-chain tamper detected — open history"
          : "Encrypted (AES-256-GCM) · hash chain verified"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        maxWidth: "100%",
        padding: "1px 6px",
        borderRadius: "var(--radius-pill)",
        border: "var(--hairline-glass)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1,
        color: fg,
        // Amber-glow alarm on tamper — icon + label carry it too (never colour-only).
        boxShadow: tampered ? "var(--accent-glow)" : undefined,
      }}
    >
      {/* Lock = encrypted (always); shield = chain-verify state. */}
      <Lock size={11} strokeWidth={2} style={{ color: iconColor, flexShrink: 0 }} aria-hidden />
      <Shield size={11} strokeWidth={2} style={{ color: iconColor, flexShrink: 0 }} aria-hidden />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}

/** Read the (optional) hash-chain verify flag off a FileDto. The field is
 * not on the wire shape yet — `find_by_id` doesn't project it — so this is
 * `undefined` today and the pill treats that as verified. Widened locally
 * (rather than touching the shared `FileDto` type) so the surface is ready
 * the moment the backend starts emitting it. */
function readChainVerified(f: FileDto): boolean | undefined {
  return (f as FileDto & { chain_verified?: boolean }).chain_verified;
}

/** Compact byte-size formatter for the vault Size column. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function GridSkeleton({ view }: { view: ViewMode }) {
  if (view === "grid") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius)",
              overflow: "hidden",
              background: "var(--bg-surface)",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* Cover region — a bordered shimmer band, never a blank box. */}
            <div
              style={{
                height: "var(--cd-card-thumb-h)",
                borderBottom: "var(--border-w) solid var(--border)",
                background: "var(--bg-sunken)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                className="skeleton"
                style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)" }}
              />
            </div>
            <div style={{ padding: "var(--cd-card-meta-pad-y) var(--cd-card-meta-pad-x)" }}>
              <div className="skeleton" style={{ height: 12, width: "72%", borderRadius: "var(--radius-2xs)" }} />
              <div
                className="skeleton"
                style={{ height: 10, width: "44%", borderRadius: "var(--radius-2xs)", marginTop: 10 }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="glass"
      style={{
        overflow: "hidden",
      }}
    >
      <VaultHeader />
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** Lucide kind icon for the dense vault row (docs-only; no media). */
function kindIconFor(kind: FileKind) {
  switch (kind) {
    case "fold":
      return FolderIcon;
    case "sheet":
      return FileSpreadsheet;
    case "doc":
    case "pdf":
      return FileText;
    default:
      return FileGeneric;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/** RT4 — translate a server-side audit action string into the
 * human-readable verb for the quiet peer toast. Returns null when the
 * action shouldn't surface as a toast (e.g. self-uploads aren't
 * informative since the SPA shows its own progress chrome). */
function verbFor(action: string): string | null {
  switch (action) {
    case "files.rename":
    case "folders.rename":
      return "renamed";
    case "files.trash":
      return "moved to trash";
    case "files.upload":
      return "uploaded";
    case "folders.create":
      return "created folder";
    default:
      return null;
  }
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} hrs ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
