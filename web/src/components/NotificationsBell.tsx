/**
 * Notifications bell — top-bar dropdown over recent recipient-facing
 * activity. Spec: docs/ux/10-bell-and-help.md.
 *
 * Pulls /api/activity?limit=20 every time the dropdown opens, plus on a
 * 60-second foreground poll. v0.2 swaps the poll for SSE / WebSocket.
 *
 * "Seen" cursor lives in localStorage (`cd-notif-seen-v1`). Opening the
 * dropdown stamps the newest visible event's created_at into the cursor
 * and clears the badge.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Link2, ShieldAlert } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import { getActivity, type ActivityEvent } from "../api/client.ts";

const SEEN_KEY = "cd-notif-seen-v1";
const POLL_MS = 60_000;

/** Action whitelist — only these surface in the bell. */
const NOTIFIABLE = new Set(["share.access", "auth.sign_in_failed"]);

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [seenAt, setSeenAt] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seqRef.current;
    try {
      const page = await getActivity(null, 20);
      if (seqRef.current !== my) return;
      const filtered = page.events.filter((e) => NOTIFIABLE.has(e.action)).slice(0, 10);
      setEvents(filtered);
    } catch {
      // Best-effort — keep the previous list rather than nuke it.
    }
  }, []);

  // Initial load + background poll while the tab is foregrounded.
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [refresh]);

  // Mark seen on open.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      void refresh();
      const newest = events[0]?.created_at;
      if (newest && newest > seenAt) {
        setSeenAt(newest);
        try {
          window.localStorage.setItem(SEEN_KEY, newest);
        } catch {
          /* ignored */
        }
      }
    }
  }

  function markAllRead() {
    const newest = events[0]?.created_at;
    if (!newest) return;
    setSeenAt(newest);
    try {
      window.localStorage.setItem(SEEN_KEY, newest);
    } catch {
      /* ignored */
    }
  }

  const unseen = events.filter((e) => e.created_at > seenAt).length;

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="press-sink" aria-label="Notifications" style={triggerStyle()}>
          <Bell size={17} strokeWidth={1.8} />
          {unseen > 0 && (
            <span
              aria-label={`${unseen} unread`}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: "var(--radius-sm)",
                border: "var(--border-w) solid var(--border)",
                background: "var(--accent)",
                color: "var(--on-violet)",
                fontSize: 10,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {unseen > 9 ? "9+" : unseen}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} style={menuStyle()}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px 8px",
            }}
          >
            <span style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>Notifications</span>
            <button
              type="button"
              className="press-sink"
              onClick={markAllRead}
              disabled={unseen === 0}
              style={{
                background: "var(--bg-surface)",
                border: "var(--border-w) solid var(--border)",
                cursor: unseen === 0 ? "default" : "pointer",
                color: unseen === 0 ? "var(--muted-2)" : "var(--ink)",
                fontSize: "var(--text-xs)",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Mark all as read
            </button>
          </header>

          <div style={{ borderTop: "var(--border-w) solid var(--border)" }} />

          {events.length === 0 ? (
            <div
              style={{
                padding: "32px 16px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "var(--text-sm)",
              }}
            >
              Nothing new.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 6, maxHeight: 360, overflowY: "auto" }}>
              {events.map((e) => (
                <Row key={e.id} event={e} unseen={e.created_at > seenAt} />
              ))}
            </ul>
          )}

          <div style={{ borderTop: "var(--border-w) solid var(--border)" }} />
          <a
            href="#"
            onClick={(ev) => {
              ev.preventDefault();
              setOpen(false);
              window.dispatchEvent(new CustomEvent("cd:nav", { detail: "activity" }));
            }}
            style={{
              display: "block",
              padding: "10px 12px",
              textAlign: "center",
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            View all activity →
          </a>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Row({ event, unseen }: { event: ActivityEvent; unseen: boolean }) {
  const Icon = event.action === "share.access" ? Link2 : ShieldAlert;
  const tone = event.action === "share.access" ? "var(--accent)" : "var(--danger)";
  return (
    <li
      style={{
        display: "flex",
        gap: 11,
        padding: "10px 10px",
        borderRadius: "var(--radius-sm)",
        background: unseen ? "var(--bg-subtle)" : "transparent",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          background: unseen ? "var(--accent-muted)" : "var(--bg-subtle)",
          color: tone,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={14} strokeWidth={1.8} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--ink)", lineHeight: 1.35 }}>
          {sentenceFor(event)}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {fmtRelative(event.created_at)}
        </div>
      </div>
    </li>
  );
}

function sentenceFor(e: ActivityEvent): string {
  const name = e.target_name ?? "(unknown)";
  switch (e.action) {
    case "share.access":
      return `Someone opened ${name}`;
    case "auth.sign_in_failed":
      return `Sign-in failed for ${name}`;
    default:
      return e.action;
  }
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── styles ─────────────────────────────────────────────────────────────

function triggerStyle(): React.CSSProperties {
  return {
    position: "relative",
    width: 36,
    height: 36,
    borderRadius: "var(--radius)",
    border: "var(--border-w) solid var(--border)",
    background: "var(--card)",
    color: "var(--muted)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function menuStyle(): React.CSSProperties {
  return {
    width: 340,
    background: "var(--card)",
    border: "var(--border-w) solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-lg)",
    fontFamily: "var(--font-sans)",
    color: "var(--ink)",
    zIndex: 60,
    animation: "cd-menu-in 180ms var(--ease)",
    overflow: "hidden",
  };
}
