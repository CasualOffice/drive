/**
 * Activity / audit-log timeline. Spec: docs/ux/06-activity-surface.md.
 *
 * Day-grouped, newest-first. Each row is one line with a category-tinted
 * pill, a sentence, and right-aligned metadata. Times in the user's local
 * timezone. Pagination via the `next_before` cursor.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  Download,
  Edit3,
  FilePlus,
  FolderPlus,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  UserCog,
} from "lucide-react";

import {
  ApiError,
  getActivity,
  type ActivityEvent,
  type ActivityPage,
} from "../api/client.ts";

export function Activity() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (before?: string | null) => {
    try {
      const page: ActivityPage = await getActivity(before ?? null);
      setEvents((prev) => (prev ? [...prev, ...page.events] : page.events));
      setCursor(page.next_before);
    } catch (e) {
      setErr((e as ApiError).message ?? "Couldn't load activity.");
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    await load(cursor);
    setLoadingMore(false);
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        background: "var(--paper)",
        padding: "40px 56px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Header />

        {err && (
          <div role="alert" style={errBox()}>
            {err}
          </div>
        )}

        {events === null ? (
          <SkeletonRows />
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <Timeline events={events} />
        )}

        {cursor && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
            <button type="button" onClick={loadMore} disabled={loadingMore} style={loadMoreBtn()}>
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: 28 }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: "var(--text-2xl)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
        }}
      >
        Activity
      </h1>
      <p
        style={{
          marginTop: 8,
          marginBottom: 0,
          fontSize: "var(--text-md)",
          color: "var(--muted)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        Everything that happens in your Drive, newest first.
      </p>
    </header>
  );
}

function Timeline({ events }: { events: ActivityEvent[] }) {
  // Group by day in the user's local timezone — never UTC.
  const groups = groupByDay(events);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {groups.map(([label, items]) => (
        <section key={label}>
          <div style={dayHeader()}>{label}</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((e) => (
              <Row key={e.id} event={e} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ event }: { event: ActivityEvent }) {
  const { Icon, tone } = categoryFor(event.action);
  const time = fmtTime(event.created_at);
  return (
    <li style={rowStyle()}>
      <span className="tabular-nums" style={{ width: 56, color: "var(--muted-2)", fontSize: 12, flexShrink: 0 }}>
        {time}
      </span>
      <Pill tone={tone}>
        <Icon size={11} strokeWidth={1.8} />
        {event.action}
      </Pill>
      <span style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--ink)", minWidth: 0 }}>
        {sentenceFor(event)}
      </span>
      <Meta event={event} />
    </li>
  );
}

function Meta({ event }: { event: ActivityEvent }) {
  let s: string | null = null;
  if (event.metadata) {
    try {
      const m = JSON.parse(event.metadata) as Record<string, unknown>;
      if (typeof m.size === "number") s = formatBytes(m.size);
      else if (typeof m.token === "string") s = `via ${(m.token as string).slice(0, 6)}…`;
      else if (m.has_password === true) s = "password-gated";
    } catch {
      // ignore — metadata is best-effort.
    }
  }
  if (event.ip_address) s = s ? `${s} · ${event.ip_address}` : event.ip_address;
  return (
    <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0, textAlign: "right" }}>
      {s ?? ""}
    </span>
  );
}

function Pill({ tone, children }: { tone: "ink" | "blue" | "gold" | "muted" | "danger"; children: React.ReactNode }) {
  // Slate Console palette — "gold" stays as a tone name for back-compat
  // with existing callers but renders as the cyan-accent variant.
  const palette = {
    ink: { bg: "rgba(15, 23, 42, 0.08)", fg: "var(--ink)" },
    blue: { bg: "rgba(37, 99, 235, 0.10)", fg: "var(--info)" },
    gold: { bg: "var(--accent-muted)", fg: "var(--accent-hover)" },
    muted: { bg: "var(--bg-subtle)", fg: "var(--muted)" },
    danger: { bg: "rgba(220, 38, 38, 0.10)", fg: "var(--danger)" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 6,
        background: palette.bg,
        color: palette.fg,
        fontSize: 11,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        fontWeight: 500,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: "60px 24px",
        textAlign: "center",
        color: "var(--muted)",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12, color: "var(--muted-2)" }}>
        <ActivityIcon size={28} strokeWidth={1.5} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", color: "var(--ink)", fontWeight: 500 }}>
        Nothing here yet.
      </div>
      <div style={{ marginTop: 4, fontSize: "var(--text-sm)" }}>
        Sign-ins, uploads, shares, and renames show up here as you use Drive.
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 36,
            borderRadius: 10,
            background: "linear-gradient(90deg, var(--bg-subtle), var(--card) 40%, var(--bg-subtle))",
            backgroundSize: "200% 100%",
            animation: "cd-skeleton 1.4s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────

function dayHeader(): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: "2.5px",
    textTransform: "uppercase",
    color: "var(--muted-2)",
    fontWeight: 600,
    padding: "0 0 8px",
    borderBottom: "1px solid var(--line)",
    marginBottom: 4,
  };
}

function rowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "9px 4px",
    borderBottom: "1px solid var(--line)",
  };
}

function loadMoreBtn(): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "var(--card)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}

function errBox(): React.CSSProperties {
  return {
    marginBottom: 16,
    padding: "10px 12px",
    background: "rgba(220, 38, 38,.06)",
    border: "1px solid rgba(220, 38, 38,.25)",
    borderRadius: 10,
    fontSize: "var(--text-sm)",
    color: "var(--danger)",
  };
}

// ── helpers ────────────────────────────────────────────────────────────

interface Category {
  Icon: typeof LogIn;
  tone: "ink" | "blue" | "gold" | "muted" | "danger";
}

function categoryFor(action: string): Category {
  if (action.startsWith("auth.")) {
    if (action.endsWith("failed")) return { Icon: ShieldAlert, tone: "danger" };
    if (action === "auth.sign_in") return { Icon: LogIn, tone: "ink" };
    if (action === "auth.sign_out") return { Icon: LogOut, tone: "ink" };
    if (action === "auth.password_changed") return { Icon: KeyRound, tone: "ink" };
    return { Icon: ShieldCheck, tone: "ink" };
  }
  if (action === "setup.admin_created") return { Icon: UserCog, tone: "ink" };
  if (action === "files.upload") return { Icon: Upload, tone: "blue" };
  if (action === "files.download") return { Icon: Download, tone: "blue" };
  if (action === "files.rename") return { Icon: Edit3, tone: "blue" };
  if (action === "files.trash") return { Icon: Trash2, tone: "danger" };
  if (action === "files.restore") return { Icon: Undo2, tone: "blue" };
  if (action === "folders.create") return { Icon: FolderPlus, tone: "blue" };
  if (action === "folders.rename") return { Icon: Edit3, tone: "blue" };
  if (action === "share.create") return { Icon: Link2, tone: "gold" };
  if (action === "share.revoke") return { Icon: Trash2, tone: "gold" };
  if (action === "share.access") return { Icon: Link2, tone: "gold" };
  return { Icon: FilePlus, tone: "muted" };
}

function sentenceFor(e: ActivityEvent): string {
  const actor = e.actor_username ?? "someone";
  const target = e.target_name ?? "(unknown)";
  switch (e.action) {
    case "auth.sign_in":
      return `${actor} signed in`;
    case "auth.sign_in_failed":
      return `sign-in failed for ${target}`;
    case "auth.sign_out":
      return `${actor} signed out`;
    case "auth.password_changed":
      return `${actor} changed their password`;
    case "setup.admin_created":
      return `first-run setup completed — ${target} created`;
    case "files.upload":
      return `${actor} uploaded ${target}`;
    case "files.rename":
      return `${actor} renamed ${target}`;
    case "files.trash":
      return `${actor} moved ${target} to trash`;
    case "files.restore":
      return `${actor} restored ${target}`;
    case "files.download":
      return `${actor} downloaded ${target}`;
    case "folders.create":
      return `${actor} created folder ${target}`;
    case "folders.rename":
      return `${actor} renamed folder ${target}`;
    case "share.create":
      return `${actor} shared ${target}`;
    case "share.revoke":
      return `${actor} revoked a share for ${target}`;
    case "share.access":
      return `someone opened ${target}`;
    default:
      return `${actor}: ${e.action}${target !== "(unknown)" ? ` — ${target}` : ""}`;
  }
}

function groupByDay(events: ActivityEvent[]): [string, ActivityEvent[]][] {
  const groups = new Map<string, ActivityEvent[]>();
  const order: string[] = [];
  for (const e of events) {
    const label = dayLabel(new Date(e.created_at));
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(e);
  }
  return order.map((k) => [k, groups.get(k)!]);
}

function dayLabel(d: Date): string {
  const today = startOfLocalDay(new Date());
  const that = startOfLocalDay(d);
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 365 ? "numeric" : undefined });
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
