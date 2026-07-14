/**
 * SR11 — recent-searches dropdown.
 *
 * Spec: docs/ux/12-search-surface.md §"Search history".
 *
 * Sits below the search input when focused. Lists the user's last 10
 * distinct queries (with the filters they had active at commit-time);
 * click an entry to re-run it. Keyboard-navigable with ↑/↓/Enter/Esc.
 *
 * When SR10 (server-side type-ahead) lands it will share this popover
 * — recents on top, server suggestions below. Designed so a later
 * patch can wedge an optional `suggestions` prop in without rewriting
 * this file.
 */
import { Clock, Filter as FilterIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { hasActiveFilters } from "../api/client.ts";
import type { RecentSearch } from "../lib/recentSearches.ts";

interface Props {
  open: boolean;
  recents: RecentSearch[];
  /** Active query — used to filter the list to prefix matches once
   * the user starts typing, per the spec's "matching the prefix"
   * note. Empty string ⇒ show all recents. */
  query: string;
  onPick: (rec: RecentSearch) => void;
  onClear: () => void;
  onClose: () => void;
  /** SR14 — fixed listbox id so the search input can wire it via
   * `aria-controls`. */
  listboxId: string;
  /** SR14 — caller receives the active option's id so it can echo it
   * on the input as `aria-activedescendant`. Null when the popover is
   * closed or has no entries. */
  onActiveOptionChange?: (id: string | null) => void;
}

export function RecentSearchesPopover({
  open,
  recents,
  query,
  onPick,
  onClear,
  onClose,
  listboxId,
  onActiveOptionChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // -1 = nothing pre-highlighted. Enter only picks a recent once the user has
  // actually arrowed into the list; a bare Enter on freshly-typed text falls
  // through to the input's own commit instead of hijacking to recents[0].
  const [activeIdx, setActiveIdx] = useState(-1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return recents;
    return recents.filter((r) => r.query.toLowerCase().includes(q));
  }, [recents, query]);

  // Reset highlight when the list changes — back to "nothing selected".
  useEffect(() => {
    setActiveIdx(-1);
  }, [filtered.length]);

  // Echo the highlighted option's DOM id to the caller so the input
  // can mirror it via `aria-activedescendant` — screen readers then
  // announce the highlighted item as the user arrows through.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    if (!open || filtered.length === 0 || activeIdx < 0) {
      onActiveOptionChange(null);
      return;
    }
    onActiveOptionChange(optionId(listboxId, activeIdx));
  }, [open, filtered, activeIdx, listboxId, onActiveOptionChange]);

  // Keyboard navigation. Listens at window level so the search input
  // can keep focus while arrow keys still drive the popover.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (filtered.length === 0 && e.key !== "Escape") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i < 0 ? 0 : (i + 1) % filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i < 0 ? filtered.length - 1 : (i - 1 + filtered.length) % filtered.length));
      } else if (e.key === "Enter") {
        // Only hijack Enter when the user has arrowed onto a recent. With
        // nothing highlighted, let the input commit the text they just typed.
        if (activeIdx < 0) return;
        const picked = filtered[activeIdx];
        if (picked) {
          e.preventDefault();
          onPick(picked);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filtered, activeIdx, onPick, onClose]);

  if (!open || filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="listbox"
      id={listboxId}
      aria-label="Recent searches"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        right: 0,
        zIndex: 60,
        background: "var(--card)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-lg)",
        overflow: "hidden",
        animation: "cd-popover-in 140ms var(--ease)",
      }}
    >
      <div
        className="caps-label"
        style={{
          padding: "8px 14px",
          borderBottom: "var(--border-w) solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Clock size={12} strokeWidth={2} />
        <span>Recent searches</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 320, overflowY: "auto" }}>
        {filtered.map((rec, i) => {
          const isActive = i === activeIdx;
          const filterCount = countActiveFilters(rec);
          return (
            <li
              key={`${rec.query}-${rec.ts}`}
              id={optionId(listboxId, i)}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                // Mouse-down before blur so the click registers.
                e.preventDefault();
                onPick(rec);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                background: isActive ? "var(--violet-100)" : "transparent",
                fontSize: "var(--text-base)",
                color: "var(--ink)",
                userSelect: "none",
              }}
            >
              <Clock
                size={13}
                strokeWidth={1.8}
                style={{ color: "var(--muted)", flexShrink: 0 }}
              />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {rec.query}
              </span>
              {filterCount > 0 && (
                <span
                  title={`${filterCount} filter${filterCount === 1 ? "" : "s"} active`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: "var(--text-xs)",
                    color: "var(--muted)",
                    background: "var(--bg-sunken)",
                    border: "var(--border-w) solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 6px",
                  }}
                >
                  <FilterIcon size={10} strokeWidth={2} />
                  {filterCount}
                </span>
              )}
              <span
                style={{ fontSize: "var(--text-xs)", color: "var(--muted-2)" }}
                title={new Date(rec.ts).toLocaleString()}
              >
                {relativeTime(rec.ts)}
              </span>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="press-sink"
        onMouseDown={(e) => {
          e.preventDefault();
          onClear();
        }}
        style={{
          width: "100%",
          padding: "9px 14px",
          border: "none",
          borderTop: "var(--border-w) solid var(--border)",
          background: "transparent",
          color: "var(--muted)",
          fontSize: "var(--text-sm)",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 7,
          transition: "background 150ms, color 150ms",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--ink)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--muted)";
        }}
      >
        <X size={13} strokeWidth={1.8} />
        Clear history
      </button>
    </div>
  );
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

function countActiveFilters(r: RecentSearch): number {
  if (!hasActiveFilters(r.filters)) return 0;
  let n = 0;
  if (r.filters.types.length) n += 1;
  if (r.filters.owner_ids.length) n += 1;
  if (r.filters.modified_after || r.filters.modified_before) n += 1;
  if (r.filters.created_after || r.filters.created_before) n += 1;
  if (r.filters.size_min !== undefined || r.filters.size_max !== undefined) n += 1;
  if (r.filters.has_share_link !== undefined) n += 1;
  if (r.filters.include_trashed) n += 1;
  if (r.filters.workspace_ids?.length) n += 1;
  return n;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
