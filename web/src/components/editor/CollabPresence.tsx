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
      ? "var(--status-success-500, #16a34a)"
      : session.status === "connecting"
        ? "var(--status-warning-500, #d97706)"
        : "var(--fg-faint, #94a3b8)";
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
          padding: "0 8px",
          borderRadius: "var(--radius-full, 999px)",
          border: "1px solid var(--border-hair)",
          background: "var(--bg-sunken)",
          fontSize: "var(--text-2xs)",
          fontWeight: "var(--weight-medium)",
          color: "var(--fg-muted)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dot,
            boxShadow: session.status === "connected" ? `0 0 0 3px color-mix(in srgb, ${dot} 22%, transparent)` : "none",
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
                border: "2px solid var(--bg-surface)",
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
                fontWeight: 600,
                color: "var(--fg-muted)",
                background: "var(--bg-raised)",
                border: "1px solid var(--border-hair)",
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
