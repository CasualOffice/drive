import { ChangeEvent, useEffect, useState } from "react";
import { KeyRound, Search } from "lucide-react";

import { clearRecent, getRecent, type RecentSearch } from "../lib/recentSearches.ts";
import { markKeystroke } from "../lib/searchMetrics.ts";
import { NotificationsBell } from "./NotificationsBell.tsx";
import { RecentSearchesPopover } from "./RecentSearchesPopover.tsx";

/** Kept for source compatibility — Files/Shell still type the shared
 * view + density state against these. The view/density toggles moved out
 * of the top bar to Settings › Display (§ UI-M6 amendment); the types stay
 * here so their consumers don't have to re-home the import. */
export type ViewMode = "grid" | "list";
export type Density = "comfortable" | "compact";

/** SR14 — fixed id so the search input's `aria-controls` and the
 * recents popover's listbox both reference the same node. */
const RECENTS_LISTBOX_ID = "cd-search-recents-listbox";

export function TopBar({
  query,
  onQueryChange,
  username,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  username: string;
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
      className="glass--thin"
      style={{
        // Thin glass chrome floating over the Aura — the mesh refracts
        // through the frost, and --shadow-float gives the bar real depth
        // off the ground (ui-vision-2026 §2.5/§5.1). Theme-adaptive peer.
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: 48,
        padding: "0 var(--space-3)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--edge-hi), var(--shadow-float)",
        border: "var(--hairline-glass)",
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

      <NotificationsBell />
      <EncryptionGlyph />
      <AccountButton username={username} />
    </header>
  );
}

/** Always-on trust cue in the chrome — encryption at rest is a product
 * invariant. Non-interactive; amber glow reads as "protected" without
 * encoding state in translucency alone (icon + accessible label). */
function EncryptionGlyph() {
  return (
    <span
      role="img"
      aria-label="Encrypted at rest with AES-256-GCM"
      title="All documents are encrypted at rest with AES-256-GCM"
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-sm)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--status-verified-700)",
        boxShadow: "var(--accent-glow)",
        flexShrink: 0,
      }}
    >
      <KeyRound size={15} strokeWidth={1.6} aria-hidden="true" />
    </span>
  );
}

/** Account entry point in the chrome. Monogram button; the menu itself is
 * owned elsewhere, so this stays a labelled affordance. */
function AccountButton({ username }: { username: string }) {
  const monogram = username.charAt(0).toUpperCase() || "?";
  return (
    <button
      type="button"
      aria-label={`Account — ${username}`}
      title={username}
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-pill)",
        border: "none",
        background: "var(--accent)",
        color: "var(--accent-fg)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: "var(--weight-semibold)",
        fontSize: "var(--text-sm)",
        flexShrink: 0,
        transition: "background var(--dur-fast), transform var(--dur-instant)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = "var(--accent-hover)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "var(--accent)";
      }}
    >
      {monogram}
    </button>
  );
}
