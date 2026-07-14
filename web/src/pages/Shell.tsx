import { lazy, Suspense, useEffect, useState } from "react";
import { Menu } from "lucide-react";

import { DEMO_MODE } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { DemoBanner } from "../components/DemoBanner.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBoundary } from "../components/ErrorBoundary.tsx";
import { HelpModal } from "../components/HelpModal.tsx";
import { Logo, Wordmark } from "../components/Logo.tsx";
import { Sidebar, type NavId } from "../components/Sidebar.tsx";
import { TopBar, type Density, type ViewMode } from "../components/TopBar.tsx";
import { decodeSearchState } from "../lib/searchUrl.ts";
import { useIsMobile } from "../lib/useMediaQuery.ts";
import { Activity } from "./Activity.tsx";
import { Admin } from "./Admin.tsx";
import { Files } from "./Files.tsx";
// Notes is route-split so the Tiptap + ProseMirror bundle (~180 KB
// gzipped) only loads when the user navigates to Notes. Spec:
// docs/research/17-notes-general-user-ux.md §"Threat model" → bundle.
const Notes = lazy(() => import("./Notes.tsx").then((m) => ({ default: m.Notes })));
import { Settings } from "./Settings.tsx";

export function Shell() {
  const { status } = useAuth();
  const username = status.kind === "authed" ? status.me.admin : "admin";
  const [nav, setNav] = useState<NavId>("home");
  // UI-M6: the view + density toggles left the top bar; the shared state
  // stays here (Files still consumes it) with defaults, pending the
  // Settings › Display controls (bucket C).
  // View + density live in Settings › Display now. Shell is the single source
  // of truth Files consumes; it seeds from the persisted `cd:files:*` keys and
  // reconciles live — Settings dispatches `cd:display` after writing, and the
  // `storage` event covers changes from another tab. Previously `view` was
  // hardcoded "grid" (so the Default-view setting did nothing) and `density`
  // was read once, needing a full reload to take effect.
  const [view, setView] = useState<ViewMode>(() => readView());
  const [density, setDensity] = useState<Density>(() => readDensity());
  useEffect(() => {
    const sync = () => {
      setView(readView());
      setDensity(readDensity());
    };
    window.addEventListener("cd:display", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("cd:display", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  // SR6 — seed query from `?q=…` on mount so deep-links and reloads
  // restore the search bar. Filters/sort restore themselves inside
  // Files.tsx (it owns that state).
  const [query, setQuery] = useState(() => readQueryFromUrl());
  const [itemCount, setItemCount] = useState(0);
  const [uploadTick, setUploadTick] = useState(0);
  const [newFolderTick, setNewFolderTick] = useState(0);
  const [newBlankTick, setNewBlankTick] = useState(0);
  const [newBlankKind, setNewBlankKind] = useState<"docx" | "xlsx" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Responsive shell — on phones the fixed sidebar becomes a
  // hamburger-triggered drawer over a dimmed scrim.
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close the drawer whenever we leave the mobile breakpoint so it never
  // lingers mounted on a resize back to desktop.
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  // SR7 — `?note=<id>` deep-link from a copied note search-result. Route to the
  // Notes tab and hand the id to <Notes> as a prop it opens on mount. This is
  // deterministic: no 200ms timer racing the lazy Tiptap chunk's load (which
  // dropped the deep-link on cold/slow loads). Runtime navigation still uses
  // the `cd:open-note` event once Notes is mounted.
  const [pendingNote] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("note");
  });
  useEffect(() => {
    if (pendingNote) setNav("notes");
  }, [pendingNote]);

  // `?` opens the help modal when the user isn't typing. Listen to the
  // bell's "View all activity →" deep-link too so a click in the dropdown
  // routes to the Activity tab.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (typing) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setHelpOpen(true);
      }
    }
    function onNav(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      // Files.tsx fires `cd:nav` when a note search-result is clicked —
      // need to flip to the Notes tab before the matching `cd:open-note`
      // event lands so Notes.tsx is mounted to receive it.
      if (detail === "activity" || detail === "notes" || detail === "home") {
        setNav(detail);
      }
    }
    // SR6 — Files.tsx owns URL writes (it has filters + sort too) and
    // fires `cd:search-query` after parsing popstate so this side can
    // sync without two parallel popstate handlers fighting.
    function onSearchQuery(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      setQuery(typeof detail === "string" ? detail : "");
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("cd:nav", onNav);
    window.addEventListener("cd:search-query", onSearchQuery);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("cd:nav", onNav);
      window.removeEventListener("cd:search-query", onSearchQuery);
    };
  }, []);

  // Sidebar props are identical for the desktop rail and the mobile
  // drawer; only `onSelect` differs (the drawer also closes on nav).
  const sidebarProps = {
    current: nav,
    itemCount,
    onNewFolder: () => setNewFolderTick((t) => t + 1),
    onUpload: () => setUploadTick((t) => t + 1),
    onNewDocument: () => {
      setNewBlankKind("docx");
      setNewBlankTick((t) => t + 1);
    },
    onNewSpreadsheet: () => {
      setNewBlankKind("xlsx");
      setNewBlankTick((t) => t + 1);
    },
    username,
  };

  return (
    <div className="h-full w-full flex flex-col" style={{ background: "transparent" }}>
      {DEMO_MODE && <DemoBanner />}
      <div className="flex" style={{ flex: 1, minHeight: 0 }}>
      {!isMobile && <Sidebar {...sidebarProps} onSelect={setNav} />}
      <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
        {/* Mobile chrome — the hamburger lives in the TopBar on Home, and
            in a slim header on every other tab so the drawer is always
            reachable once the fixed rail is gone. */}
        {isMobile && nav !== "home" && (
          <MobileHeader onMenuClick={() => setDrawerOpen(true)} />
        )}
        {nav === "home" && (
          <div style={{ padding: isMobile ? "8px var(--space-3) 0" : "8px var(--space-6) 0" }}>
            <TopBar
              query={query}
              onQueryChange={setQuery}
              username={username}
              onMenuClick={isMobile ? () => setDrawerOpen(true) : undefined}
            />
          </div>
        )}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* One crashing surface (or a stale lazy-chunk after a redeploy)
              must not take down the sidebar/topbar. Keyed by `nav` so
              switching tabs clears a caught error and remounts cleanly. */}
          <ErrorBoundary resetKey={nav} surface={nav}>
          {nav === "home" && (
            <Files
              view={view}
              density={density}
              query={query}
              uploadRequested={uploadTick}
              onUploadHandled={() => {}}
              newFolderRequested={newFolderTick}
              onNewFolderHandled={() => {}}
              newBlankRequested={newBlankTick}
              newBlankKind={newBlankKind}
              onNewBlankHandled={() => setNewBlankKind(null)}
              onItemCount={setItemCount}
            />
          )}
          {nav === "trash" && (
            <CenteredPane>
              <EmptyState
                title="Trash is empty."
                subtitle="Files you delete will appear here for 30 days before being permanently removed."
              />
            </CenteredPane>
          )}
          {nav === "notes" && (
            <Suspense
              fallback={
                <CenteredPane>
                  <EmptyState title="Loading notes…" subtitle="" />
                </CenteredPane>
              }
            >
              <Notes initialNoteId={pendingNote} />
            </Suspense>
          )}
          {nav === "activity" && <Activity />}
          {nav === "admin" && <Admin onNavigate={(t) => setNav(t)} />}
          {nav === "settings" && <Settings />}
          </ErrorBoundary>
        </main>
      </div>
      </div>

      {isMobile && (
        <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <Sidebar
            {...sidebarProps}
            onSelect={(id) => {
              setNav(id);
              setDrawerOpen(false);
            }}
          />
        </SidebarDrawer>
      )}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setNav}
        onOpenFile={(file) => {
          // Surface the right tab + fire a custom event Files listens for.
          setNav("home");
          window.dispatchEvent(
            new CustomEvent<string>("cd:open-file", { detail: file.id }),
          );
        }}
        onOpenNote={(id) => {
          setNav("notes");
          window.dispatchEvent(
            new CustomEvent<string>("cd:open-note", { detail: id }),
          );
        }}
        onShowHelp={() => setHelpOpen(true)}
        onNewDocument={() => {
          setNav("home");
          setNewBlankKind("docx");
          setNewBlankTick((t) => t + 1);
        }}
        onNewFolder={() => {
          setNav("home");
          setNewFolderTick((t) => t + 1);
        }}
        onUpload={() => {
          setNav("home");
          setUploadTick((t) => t + 1);
        }}
      />
    </div>
  );
}

const DENSITY_STORAGE_KEY = "cd:files:density";
const VIEW_STORAGE_KEY = "cd:files:view";

function readView(): ViewMode {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function readQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return decodeSearchState(window.location.search).query;
  } catch {
    return "";
  }
}

function readDensity(): Density {
  if (typeof window === "undefined") return "comfortable";
  try {
    const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return raw === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Slim mobile chrome for the non-Home tabs (Activity / Admin / Settings /
 * Notes / Trash) — carries the hamburger + wordmark so the drawer stays
 * reachable once the fixed rail collapses. Neobrutalist: flat surface,
 * 2px ink bottom border. */
function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 52,
        flexShrink: 0,
        padding: "0 var(--space-3)",
        background: "var(--bg-surface)",
        borderBottom: "var(--border-w) solid var(--border)",
      }}
    >
      <button
        type="button"
        aria-label="Open menu"
        data-testid="mobile-menu"
        className="press-sink"
        onClick={onMenuClick}
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-surface)",
          color: "var(--fg-default)",
          cursor: "pointer",
        }}
      >
        <Menu size={18} strokeWidth={2.2} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: "var(--violet-500)", ["--mark-fg" as string]: "var(--bg-surface)" }}>
          <Logo size={26} />
        </div>
        <div style={{ color: "var(--ink)" }}>
          <Wordmark tone="rail" />
        </div>
      </div>
    </header>
  );
}

/** Off-canvas sidebar drawer for phones. Hidden by default; opens over a
 * dimmed (not blurred) scrim as a neobrutalist bordered panel with a hard
 * offset shadow. Closes on scrim click, Esc, or nav (the child's onSelect
 * closes it). The child <Sidebar> keeps its own 240px width + border. */
function SidebarDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--bg-overlay)",
          zIndex: 90,
          animation: "cd-scrim-in 160ms var(--ease)",
        }}
      />
      <div
        role="dialog"
        aria-label="Navigation"
        data-testid="sidebar-drawer"
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 100,
          maxWidth: "86vw",
          boxShadow: "var(--shadow-lg)",
          borderRight: "var(--border-w) solid var(--border)",
          animation: "cd-drawer-in 200ms var(--ease)",
        }}
      >
        {children}
      </div>
      <style>{`
        @keyframes cd-scrim-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cd-drawer-in {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="sidebar-drawer"] { animation: none; }
        }
      `}</style>
    </>
  );
}

function CenteredPane({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        // Flat neobrutalist canvas — the dotted ground shows through; cards
        // and empty states carry the borders + hard shadows.
        background: "transparent",
        padding: "var(--space-6) var(--space-6) 40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}
