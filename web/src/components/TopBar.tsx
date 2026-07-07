import { ChangeEvent, useEffect, useState } from "react";
import { Grid3x3, HelpCircle, List, Rows3, Rows4, Search } from "lucide-react";

import { clearRecent, getRecent, type RecentSearch } from "../lib/recentSearches.ts";
import { markKeystroke } from "../lib/searchMetrics.ts";
import { NotificationsBell } from "./NotificationsBell.tsx";
import { RecentSearchesPopover } from "./RecentSearchesPopover.tsx";

export type ViewMode = "grid" | "list";
export type Density = "comfortable" | "compact";

/** SR14 — fixed id so the search input's `aria-controls` and the
 * recents popover's listbox both reference the same node. */
const RECENTS_LISTBOX_ID = "cd-search-recents-listbox";

export function TopBar({
  query,
  onQueryChange,
  view,
  onViewChange,
  density,
  onDensityChange,
  onShowHelp,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  density: Density;
  onDensityChange: (d: Density) => void;
  onShowHelp: () => void;
}) {
  // SR11 — recent-searches dropdown state. Recents are loaded lazily
  // (only when the input gains focus, so a never-focused TopBar
  // doesn't pay the localStorage parse) and refreshed whenever Files
  // emits `cd:recents-changed` after a commit.
  const [inputFocused, setInputFocused] = useState(false);
  const [recents, setRecents] = useState<RecentSearch[]>([]);
  // SR14 — id of the currently-highlighted option in the recents
  // popover. Mirrored on the input as `aria-activedescendant` so
  // screen readers announce the row as the user arrows through.
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);

  useEffect(() => {
    function refresh() {
      setRecents(getRecent());
    }
    window.addEventListener("cd:recents-changed", refresh);
    return () => window.removeEventListener("cd:recents-changed", refresh);
  }, []);

  const popoverOpen = inputFocused && recents.length > 0;
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: 48,
      }}
    >
      <div
        role="search"
        style={{ position: "relative", flex: "1 1 auto", maxWidth: 320, marginLeft: "auto" }}
      >
        <Search
          size={15}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--fg-subtle)",
          }}
        />
        <input
          type="text"
          placeholder="Search documents and folders"
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={RECENTS_LISTBOX_ID}
          aria-expanded={popoverOpen}
          aria-activedescendant={popoverOpen ? activeOptionId ?? undefined : undefined}
          aria-label="Search documents and folders"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            // SR15 — open a keystroke→paint measurement window if one
            // isn't already pending. Subsequent keystrokes inside the
            // window are folded into the same measurement so the
            // debounce delay shows up as part of perceived latency.
            markKeystroke();
            onQueryChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim().length > 0) {
              // SR11 — Files owns search state, so it gets to record
              // the commit alongside its current filter snapshot.
              window.dispatchEvent(
                new CustomEvent<string>("cd:search-commit", { detail: query }),
              );
            }
          }}
          style={{
            width: "100%",
            height: 30,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-sunken)",
            borderRadius: "var(--radius-sm)",
            padding: "0 12px 0 30px",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            color: "var(--fg-default)",
            outline: "none",
            transition: "border-color var(--dur-base), box-shadow var(--dur-base)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--border-focus)";
            e.currentTarget.style.boxShadow = "var(--shadow-focus)";
            setInputFocused(true);
            setRecents(getRecent());
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border-strong)";
            e.currentTarget.style.boxShadow = "";
            // Defer the close so a click on a popover entry
            // (mousedown fires before blur) lands before the popover
            // unmounts.
            setTimeout(() => setInputFocused(false), 120);
            // Also commit on blur when the user typed something but
            // never hit Enter — keeps the recents list useful for
            // users who navigate via clicks instead of keyboard.
            if (query.trim().length > 0) {
              window.dispatchEvent(
                new CustomEvent<string>("cd:search-commit", { detail: query }),
              );
            }
          }}
        />
        <RecentSearchesPopover
          open={popoverOpen}
          recents={recents}
          query={query}
          listboxId={RECENTS_LISTBOX_ID}
          onActiveOptionChange={setActiveOptionId}
          onPick={(rec) => {
            onQueryChange(rec.query);
            window.dispatchEvent(
              new CustomEvent<typeof rec.filters>("cd:apply-filters", {
                detail: rec.filters,
              }),
            );
            setInputFocused(false);
          }}
          onClear={() => {
            clearRecent();
            setRecents([]);
          }}
          onClose={() => setInputFocused(false)}
        />
      </div>

      <ViewToggle value={view} onChange={onViewChange} />
      <DensityToggle value={density} onChange={onDensityChange} />
      <NotificationsBell />
      <IconButton
        ariaLabel="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={onShowHelp}
      >
        <HelpCircle size={16} strokeWidth={1.5} />
      </IconButton>
    </header>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <ToggleGroup>
      <ToggleButton active={value === "grid"} onClick={() => onChange("grid")} title="Grid view">
        <Grid3x3 size={16} strokeWidth={1.5} />
      </ToggleButton>
      <ToggleButton active={value === "list"} onClick={() => onChange("list")} title="List view">
        <List size={16} strokeWidth={1.5} />
      </ToggleButton>
    </ToggleGroup>
  );
}

/** SR4 — row-density toggle. `Rows3` = comfortable; `Rows4` = compact. */
function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <ToggleGroup label="Row density">
      <ToggleButton
        active={value === "comfortable"}
        onClick={() => onChange("comfortable")}
        title="Comfortable density"
      >
        <Rows3 size={16} strokeWidth={1.5} />
      </ToggleButton>
      <ToggleButton
        active={value === "compact"}
        onClick={() => onChange("compact")}
        title="Compact density"
      >
        <Rows4 size={16} strokeWidth={1.5} />
      </ToggleButton>
    </ToggleGroup>
  );
}

function ToggleGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      style={{
        display: "flex",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-surface)",
        padding: 2,
        gap: 2,
      }}
    >
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "var(--accent-wash)" : "transparent",
        cursor: "pointer",
        width: 24,
        height: 24,
        borderRadius: "var(--radius-xs)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: active ? "var(--fg-default)" : "var(--fg-muted)",
        transition: "background var(--dur-base), color var(--dur-base)",
      }}
      onMouseOver={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function IconButton({
  ariaLabel,
  title,
  onClick,
  children,
}: {
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-sm)",
        border: "none",
        background: "transparent",
        color: "var(--fg-muted)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background var(--dur-fast), color var(--dur-fast)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "var(--bg-hover)";
        e.currentTarget.style.color = "var(--fg-default)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--fg-muted)";
      }}
    >
      {children}
    </button>
  );
}
