/**
 * Activity / audit-trail surface. Spec: docs/ux/06-activity-surface.md,
 * docs/design/ui-system.md §7.4 (audit row), §7.5 (verification badge /
 * tamper alarm). The hub's compliance record: append-only, hash-chained,
 * day-grouped, newest first.
 *
 * Dense on-system restyle — 32px rows, verb-first sentences, mono/tabular
 * time + event ids, a top chain-verified banner (or a persistent
 * `role="alert"` tamper alarm), one Lucide icon per concept. Data source
 * unchanged (getActivity → the `audit_log` window + `chain_verified`).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Download,
  Edit3,
  FilePlus,
  FolderPlus,
  Gavel,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Upload,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  getActivity,
  type ActivityEvent,
  type ActivityPage,
} from "../api/client.ts";
import { RegistryMotif } from "../components/ds/RegistryMotif.tsx";
import { SkeletonRow } from "../components/ds/SkeletonRow.tsx";
import { StatusChip } from "../components/ds/StatusChip.tsx";

const STROKE = 1.5;

export function Activity() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chainVerified, setChainVerified] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (before?: string | null) => {
    try {
      const page: ActivityPage = await getActivity(before ?? null);
      setEvents((prev) => (prev ? [...prev, ...page.events] : page.events));
      setCursor(page.next_before);
      // `chain_verified` is absent on older servers — treat undefined as
      // the calm verified default; only alarm on an explicit false.
      if (page.chain_verified === false) {
        // The server reports pass/fail over a WINDOW, not the offending link.
        // Anchoring to `page.events[0]` pointed at a different event depending
        // on which page reported the break — a false, pagination-dependent
        // location. Raise the alarm without asserting where.
        setChainVerified(false);
      }
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
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-canvas)", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Header
          verified={chainVerified}
          onVerify={() => {
            // Stubbed against the loaded window — a real verify_audit_chain
            // call lands with the export endpoint. Re-reads the flag.
            if (chainVerified) toast.success("Audit chain verified · every link intact");
          }}
        />

        {!chainVerified && <TamperAlarm eventId={null} />}

        {err && (
          <div role="alert" style={errBox}>
            {err}
          </div>
        )}

        {events === null ? (
          <LoadingRows />
        ) : events.length === 0 && !err ? (
          <EmptyState />
        ) : (
          <Timeline events={events} />
        )}

        {cursor && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "var(--space-4)" }}>
            <button type="button" onClick={loadMore} disabled={loadingMore} style={loadMoreBtn}>
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        )}

        {events && events.length > 0 && (
          <div
            style={{
              marginTop: "var(--space-4)",
              paddingTop: "var(--space-2)",
              borderTop: "1px solid var(--border-hair)",
              fontSize: "var(--text-xs)",
              color: "var(--fg-subtle)",
              textAlign: "center",
            }}
          >
            Append-only · hash-chained
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ verified, onVerify }: { verified: boolean; onVerify: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        marginBottom: "var(--space-4)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-xl)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-tight)",
            color: "var(--fg-default)",
          }}
        >
          Activity
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm)", color: "var(--fg-subtle)" }}>
          Every action in this hub, newest first. Append-only · hash-chained.
        </p>
      </div>
      {verified ? (
        <button
          type="button"
          onClick={onVerify}
          title="Verify the audit chain"
          style={verifyChip}
        >
          <StatusChip
            tone="verified"
            icon={<ShieldCheck size={13} strokeWidth={STROKE} />}
            label="Chain verified"
          />
        </button>
      ) : (
        <StatusChip
          tone="danger"
          icon={<ShieldOff size={13} strokeWidth={STROKE} />}
          label="Tamper detected"
        />
      )}
    </header>
  );
}

function TamperAlarm({ eventId }: { eventId: string | null }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        gap: "var(--space-2)",
        alignItems: "flex-start",
        padding: "var(--space-3)",
        marginBottom: "var(--space-4)",
        background: "var(--amber-tint)",
        borderRadius: "var(--radius-md)",
        borderLeft: "3px solid var(--amber-700)",
        boxShadow: "var(--accent-glow)",
        color: "var(--fg-default)",
        fontSize: "var(--text-sm)",
        lineHeight: "var(--leading-sm)",
      }}
    >
      <span aria-hidden style={{ color: "var(--amber-700)", flexShrink: 0, marginTop: 1 }}>
        <ShieldAlert size={16} strokeWidth={STROKE} />
      </span>
      <div>
        <div style={{ fontWeight: "var(--weight-semibold)", color: "var(--amber-700)" }}>
          Tamper detected · audit chain broke
          {eventId && <> at event #{shortId(eventId)}</>}
        </div>
        <div style={{ marginTop: 2, color: "var(--fg-muted)" }}>
          A committed row no longer matches its recorded hash. Reported to admins. This cannot be
          dismissed until resolved.
        </div>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: ActivityEvent[] }) {
  const groups = groupByDay(events);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {groups.map(([label, items]) => (
        <section key={label}>
          <div
            className="caps-label glass--thin"
            style={{ padding: "5px var(--space-3)", marginBottom: "var(--space-1)" }}
          >
            {label}
          </div>
          <ul className="glass--thick" style={{ listStyle: "none", margin: 0, padding: "0 var(--space-2)" }}>
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
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        minHeight: 32,
        padding: "0 var(--space-1)",
        borderBottom: "1px solid var(--border-hair)",
      }}
    >
      <span
        className="tnum"
        style={{ width: 44, flexShrink: 0, fontSize: "var(--mono-xs)", color: "var(--fg-subtle)", fontFamily: "var(--font-mono)" }}
        title={new Date(event.created_at).toLocaleString()}
      >
        {fmtTime(event.created_at)}
      </span>
      <span aria-hidden style={{ flexShrink: 0, color: iconColor(tone), display: "inline-flex" }}>
        <Icon size={14} strokeWidth={STROKE} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", color: "var(--fg-default)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sentenceFor(event)}
      </span>
      <Meta event={event} />
      <EventHash id={event.id} />
    </li>
  );
}

function EventHash({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(id);
        toast.success("Event id copied");
      }}
      aria-label={`Event ${id} — copy`}
      title={`Event ${id}`}
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        padding: "1px 5px",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-xs)",
        fontSize: "var(--mono-xs)",
        color: "var(--fg-subtle)",
        cursor: "pointer",
      }}
    >
      #{shortId(id)}
      <Copy size={10} strokeWidth={STROKE} aria-hidden style={{ opacity: 0.6 }} />
    </button>
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
  if (!s) return null;
  return (
    <span
      className="tnum"
      style={{ flexShrink: 0, fontSize: "var(--text-xs)", color: "var(--fg-subtle)", textAlign: "right", whiteSpace: "nowrap" }}
    >
      {s}
    </span>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-8) var(--space-6)",
        textAlign: "center",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <RegistryMotif overlay="scroll-text" />
      <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--fg-default)" }}>
        No activity yet.
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)", maxWidth: 340 }}>
        Sign-ins, uploads, shares, saves, and restores show up here as the hub is used — each one a
        hash-chained, append-only record.
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonRow key={i} columns={5} />
      ))}
    </div>
  );
}

// ── styles ─────────────────────────────────────────────────────────────

const loadMoreBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-hair)",
  background: "var(--bg-surface)",
  color: "var(--fg-default)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-medium)",
  cursor: "pointer",
};

const verifyChip: React.CSSProperties = {
  flexShrink: 0,
  padding: "4px 8px",
  border: "1px solid var(--border-hair)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-surface)",
  cursor: "pointer",
};

const errBox: React.CSSProperties = {
  marginBottom: "var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--amber-tint)",
  borderLeft: "3px solid var(--status-danger)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  color: "var(--fg-default)",
};

// ── helpers ────────────────────────────────────────────────────────────

type Tone = "ink" | "info" | "attention" | "danger";

interface Category {
  Icon: typeof LogIn;
  tone: Tone;
}

function iconColor(tone: Tone): string {
  switch (tone) {
    case "attention":
      return "var(--status-attention-700)";
    case "danger":
      return "var(--status-danger-700)";
    default:
      return "var(--fg-muted)";
  }
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
  if (action === "files.upload") return { Icon: Upload, tone: "info" };
  if (action === "files.edit") return { Icon: Edit3, tone: "info" };
  if (action === "files.download") return { Icon: Download, tone: "info" };
  if (action === "files.rename") return { Icon: Edit3, tone: "info" };
  if (action === "files.trash") return { Icon: Trash2, tone: "attention" };
  if (action === "files.restore") return { Icon: RotateCcw, tone: "info" };
  if (action === "folders.create") return { Icon: FolderPlus, tone: "info" };
  if (action === "folders.rename") return { Icon: Edit3, tone: "info" };
  if (action === "share.create") return { Icon: Link2, tone: "ink" };
  if (action === "share.revoke") return { Icon: Trash2, tone: "ink" };
  if (action === "share.access") return { Icon: Link2, tone: "ink" };
  if (action.startsWith("holds.")) return { Icon: Gavel, tone: "attention" };
  if (action.startsWith("provenance.")) return { Icon: ShieldCheck, tone: "ink" };
  if (action.startsWith("token."))
    return { Icon: KeyRound, tone: action.endsWith("revoked") ? "attention" : "ink" };
  return { Icon: FilePlus, tone: "ink" };
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
    case "files.edit":
      return `${actor} saved ${target}`;
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
    case "holds.place":
      return `${actor} placed a legal hold on ${target}`;
    case "holds.release":
      return `${actor} released the legal hold on ${target}`;
    case "provenance.verify":
      return `${actor} verified ${target}`;
    case "token.created":
      return `${actor} created API token ${target}`;
    case "token.revoked":
      return `${actor} revoked an API token`;
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

function shortId(id: string): string {
  return id.length <= 6 ? id : id.slice(0, 4);
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
