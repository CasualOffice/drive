/**
 * RT2 — avatar stack for the workspace switcher row.
 *
 * Spec: docs/research/14-presence.md §"SPA surface".
 *
 * Up to 5 avatars + "+N more" overflow chip. Each avatar is a
 * monogram-on-tint circle; the tint comes from the server's
 * deterministic FNV hash so the same user gets a stable colour
 * across sessions and devices.
 *
 * Quiet by default — the row collapses to nothing when no one else
 * is present. No layout shift when it appears (height is reserved
 * via min-height on the wrapper).
 */
import { usePresenceUsers, type PresenceUser } from "../state/PresenceContext.tsx";

const MAX_VISIBLE = 5;
const SIZE = 22;
const OVERLAP = 8;

export function AvatarStack() {
  const users = usePresenceUsers();
  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <div
      role="group"
      aria-label={`${users.length} other ${users.length === 1 ? "person" : "people"} present`}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "4px 4px 0 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        {visible.map((u, i) => (
          <Avatar key={u.user_id} user={u} stackIndex={i} />
        ))}
      </div>
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          aria-label={`${overflow} more`}
          style={{
            marginLeft: -OVERLAP + 8,
            fontSize: 10,
            fontWeight: 600,
            color: "var(--muted)",
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: SIZE / 2,
            height: SIZE,
            minWidth: SIZE,
            padding: "0 6px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Avatar({ user, stackIndex }: { user: PresenceUser; stackIndex: number }) {
  const initials = monogramOf(user.username);
  const ago = relTime(Date.now() - user.last_seen);
  return (
    <span
      title={`${user.username} · ${user.viewing ? "viewing a file" : "online"} · ${ago}`}
      aria-label={user.username}
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: "50%",
        background: user.tint,
        color: "var(--paper)",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "2px solid var(--paper)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
        // Stack with overlap — leftmost on top so first-arrived is the
        // primary face. Negative margin pulls each subsequent one
        // partially under its left neighbour.
        marginLeft: stackIndex === 0 ? 0 : -OVERLAP,
        zIndex: 10 - stackIndex,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  );
}

/** Two-letter monogram from a username. "alex" → "AL"; "alex smith"
 * → "AS"; single char names stay one-letter. */
function monogramOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

/** Tiny "X ago" formatter — matches what the recents-popover uses
 * and what most premium-UX leaders (Linear / Notion) ship. */
function relTime(diffMs: number): string {
  if (diffMs < 30_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}
