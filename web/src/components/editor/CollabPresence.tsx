/**
 * CollabPresence — live co-editing indicator for the editor header.
 *
 * Reads a `CollabSession` (from `useCollabSession`) and renders:
 *   - a connection dot ("Live" / "Connecting…" / "Offline");
 *   - an avatar pile of the *other* peers in the room, each tinted and
 *     tagged editing vs viewing (from Yjs awareness).
 *
 * Distinct from `<FilePresenceStack>`, which shows workspace *viewers*
 * over SSE. This stack shows the people actually joined to the live
 * collab room — the co-editors. When collab is disabled (single-user
 * fallback) the whole component collapses to nothing, so the header is
 * unchanged from P2.1.
 */

import type { CollabSession } from "../../lib/collab.ts";
import { otherPeers } from "../../lib/collab.ts";

const MAX_VISIBLE = 4;
const SIZE = 24;
const OVERLAP = 8;

export function CollabPresence({ session }: { session: CollabSession }) {
  if (!session.enabled) return null;

  const peers = otherPeers(session);
  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;

  const dot =
    session.status === "connected"
      ? "var(--ok)"
      : session.status === "connecting"
        ? "var(--warn)"
        : "var(--ink-soft)";
  const label =
    session.status === "connected"
      ? peers.length > 0
        ? `Live · ${peers.length} editing`
        : "Live"
      : session.status === "connecting"
        ? "Connecting…"
        : "Offline";

  return (
    <div
      role="group"
      data-testid="collab-presence"
      data-collab-status={session.status}
      aria-label={`Co-editing: ${label}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <span
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 9px",
          borderRadius: "var(--radius-xs)",
          border: "var(--border-w) solid var(--border)",
          boxShadow: "var(--shadow-sm)",
          background: "var(--bg-surface)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--ink)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dot,
            border: "1.5px solid var(--border)",
          }}
        />
        {label}
      </span>

      {visible.length > 0 && (
        <div style={{ display: "flex", alignItems: "center" }}>
          {visible.map((p, i) => (
            <span
              key={p.clientId}
              title={`${p.name} · ${p.activity}`}
              aria-label={`${p.name} ${p.activity}`}
              style={{
                width: SIZE,
                height: SIZE,
                borderRadius: "50%",
                background: p.tint,
                color: "var(--paper, #fff)",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "var(--border-w) solid var(--border)",
                marginLeft: i === 0 ? 0 : -OVERLAP,
                zIndex: 10 - i,
                flexShrink: 0,
                opacity: p.activity === "viewing" ? 0.7 : 1,
              }}
            >
              {monogram(p.name)}
            </span>
          ))}
          {overflow > 0 && (
            <span
              aria-label={`${overflow} more`}
              style={{
                marginLeft: -OVERLAP + 4,
                fontSize: 10,
                fontWeight: 700,
                color: "var(--ink)",
                background: "var(--bg-surface)",
                border: "var(--border-w) solid var(--border)",
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
      )}
    </div>
  );
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}
