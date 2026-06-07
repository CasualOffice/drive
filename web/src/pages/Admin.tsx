/**
 * Admin dashboard. Spec: docs/ux/11-admin-surface.md.
 *
 * Read-only snapshot of system state for the operator. Sectioned cards;
 * no nested nav (admins debugging an incident want every datapoint
 * visible at once).
 */
import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  CheckCircle2,
  Database,
  HardDrive,
  KeyRound,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { ApiError, getAdminSystem, type AdminSystem } from "../api/client.ts";
import { UsersCard } from "./admin/UsersCard.tsx";

type State =
  | { kind: "loading" }
  | { kind: "ready"; system: AdminSystem }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export function Admin({ onNavigate }: { onNavigate: (target: "activity") => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    void getAdminSystem()
      .then((system) => setState({ kind: "ready", system }))
      .catch((err: ApiError) => {
        if (err.status === 403) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: err.message ?? "Couldn't load admin." });
      });
  }, []);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        background: "var(--paper)",
        padding: "40px 56px 80px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Header />

        {state.kind === "loading" && <Skeletons />}
        {state.kind === "forbidden" && <ForbiddenNotice />}
        {state.kind === "error" && (
          <div role="alert" style={errBox()}>{state.message}</div>
        )}
        {state.kind === "ready" && <Body system={state.system} onNavigate={onNavigate} />}
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
        Admin
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
        Read-only view of how this Drive instance is configured.
      </p>
    </header>
  );
}

function Body({
  system,
  onNavigate,
}: {
  system: AdminSystem;
  onNavigate: (target: "activity") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SystemCard system={system} />
      <UsersCard />
      <StorageCard system={system} />
      <SessionsCard system={system} />
      <RecentSignInsCard system={system} onNavigate={onNavigate} />
      <SearchCacheCard />
      <AntiVirusCard />
    </div>
  );
}

// ── System card ────────────────────────────────────────────────────────

function SystemCard({ system }: { system: AdminSystem }) {
  return (
    <Card title="System">
      <Grid>
        <Stat
          label="Status"
          value={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {system.healthy ? (
                <>
                  <CheckCircle2 size={14} strokeWidth={2} style={{ color: "var(--success)" }} />
                  Healthy
                </>
              ) : (
                <>
                  <ShieldAlert size={14} strokeWidth={2} style={{ color: "var(--warning)" }} />
                  Degraded
                </>
              )}
            </span>
          }
        />
        <Stat label="Uptime" value={fmtDuration(system.uptime_seconds)} />
        <Stat label="Version" value={`${system.version}${system.git_sha !== "unknown" ? ` · ${system.git_sha}` : ""}`} />
        <Stat label="Built" value={fmtDateTime(system.built_at)} />
        <Stat label="Storage backend" value={system.storage_backend} />
        <Stat label="Database" value={system.db_backend} />
      </Grid>
    </Card>
  );
}

// ── Storage card ───────────────────────────────────────────────────────

function StorageCard({ system }: { system: AdminSystem }) {
  const { fs_root, s3_bucket, s3_endpoint, s3_region } = system.storage_config;
  return (
    <Card
      title="Storage adapter"
      subtitle="Configured at boot via DRIVE_BACKEND. Switching backends requires a restart."
    >
      <Row icon={<HardDrive size={15} strokeWidth={1.7} />} label="Backend" value={system.storage_backend} />
      {fs_root && (
        <Row icon={<HardDrive size={15} strokeWidth={1.7} />} label="Filesystem root" value={fs_root} mono />
      )}
      {s3_bucket && (
        <>
          <Row icon={<HardDrive size={15} strokeWidth={1.7} />} label="S3 bucket" value={s3_bucket} mono />
          {s3_region && <Row icon={<HardDrive size={15} strokeWidth={1.7} />} label="Region" value={s3_region} />}
          {s3_endpoint && (
            <Row
              icon={<HardDrive size={15} strokeWidth={1.7} />}
              label="Endpoint"
              value={s3_endpoint}
              mono
            />
          )}
        </>
      )}
      {!fs_root && !s3_bucket && (
        <div style={{ padding: "6px 4px", fontSize: "var(--text-xs)", color: "var(--muted)" }}>
          In-memory backend — for tests + demo only.
        </div>
      )}
    </Card>
  );
}

// ── Sessions ───────────────────────────────────────────────────────────

function SessionsCard({ system }: { system: AdminSystem }) {
  return (
    <Card title="Sessions">
      <Row
        icon={<Users size={15} strokeWidth={1.7} />}
        label="Active sessions"
        value={String(system.active_sessions)}
      />
      <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--muted)" }}>
        Per-device list + per-device revoke ship in v0.2 with the sessions IP + user-agent columns.
      </div>
    </Card>
  );
}

// ── Recent sign-ins ────────────────────────────────────────────────────

function RecentSignInsCard({
  system,
  onNavigate,
}: {
  system: AdminSystem;
  onNavigate: (target: "activity") => void;
}) {
  return (
    <Card
      title="Recent sign-ins"
      subtitle="Latest 10 events from the audit log."
    >
      {system.recent_sign_ins.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)", padding: "4px 0" }}>
          No sign-in events recorded yet.
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 0 }}>
          {system.recent_sign_ins.map((s, i) => (
            <li
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "9px 4px",
                borderBottom: i === system.recent_sign_ins.length - 1 ? "none" : "1px solid var(--line)",
              }}
            >
              {s.ok ? (
                <ShieldCheck size={14} strokeWidth={1.8} style={{ color: "var(--success)" }} />
              ) : (
                <XCircle size={14} strokeWidth={1.8} style={{ color: "var(--danger)" }} />
              )}
              <span style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
                {s.ok ? "" : <em style={{ color: "var(--muted)" }}>failed · </em>}
                {s.actor_username ?? "(unknown)"}
              </span>
              <span className="tabular-nums" style={{ fontSize: 12, color: "var(--muted)" }}>
                {fmtRelativeTime(s.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button type="button" onClick={() => onNavigate("activity")} style={linkBtn()}>
          <ActivityIcon size={13} strokeWidth={1.8} />
          Open audit log →
        </button>
      </div>
    </Card>
  );
}

// ── Stubs ──────────────────────────────────────────────────────────────

function SearchCacheCard() {
  return (
    <Card title="Search & cache" badge="Coming in v0.2">
      <p style={{ margin: "0 0 6px", fontSize: "var(--text-sm)", color: "var(--ink-soft)", lineHeight: "var(--leading-normal)" }}>
        OpenSearch + Redis dashboards light up here when the optional infra is enabled via env. Both are opt-in.
      </p>
      <Row icon={<Search size={15} strokeWidth={1.7} />} label="OpenSearch" value="Not enabled" />
      <Row icon={<Database size={15} strokeWidth={1.7} />} label="Redis cache" value="Not enabled" />
    </Card>
  );
}

function AntiVirusCard() {
  return (
    <Card title="Anti-virus scanner" badge="Coming in v0.2">
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-soft)", lineHeight: "var(--leading-normal)" }}>
        Sandboxed ClamAV scanner on upload, with a one-click toggle here once the integration lands.
      </p>
    </Card>
  );
}

// ── Skeletons / states ─────────────────────────────────────────────────

function Skeletons() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 120,
            borderRadius: 16,
            background: "linear-gradient(90deg, var(--bg-subtle), var(--card) 40%, var(--bg-subtle))",
            backgroundSize: "200% 100%",
            animation: "cd-skeleton 1.4s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

function ForbiddenNotice() {
  return (
    <div
      style={{
        padding: "32px 28px",
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        textAlign: "center",
      }}
    >
      <div style={{ color: "var(--muted-2)", marginBottom: 10 }}>
        <KeyRound size={22} strokeWidth={1.5} />
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: "var(--text-xl)",
          color: "var(--ink)",
        }}
      >
        Admin access required.
      </h2>
      <p style={{ margin: "8px 0 0", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        Ask your workspace owner to promote your account, or sign in as an admin.
      </p>
    </div>
  );
}

// ── primitives ─────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "22px 24px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: "var(--text-lg)",
            color: "var(--ink)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {title}
        </h3>
        {badge && (
          <span
            style={{
              fontSize: 10,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              color: "var(--accent)",
              background: "var(--accent-muted)",
              border: "1px solid rgba(200,164,92,.32)",
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 600,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <p
          style={{
            marginTop: 6,
            marginBottom: 0,
            fontSize: "var(--text-sm)",
            color: "var(--muted)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {subtitle}
        </p>
      )}
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "14px 24px",
      }}
    >
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{label}</div>
      <div
        className="tabular-nums"
        style={{ marginTop: 2, fontSize: "var(--text-md)", color: "var(--ink)", fontWeight: 500 }}
      >
        {value}
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 140px 1fr",
        alignItems: "center",
        gap: 12,
        padding: "9px 4px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ color: "var(--muted)" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--ink)",
          fontWeight: 500,
          fontFamily: mono ? "var(--font-mono, ui-monospace, monospace)" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function linkBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 9,
    border: "1px solid var(--line)",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}

function errBox(): React.CSSProperties {
  return {
    padding: "10px 12px",
    background: "rgba(176,69,69,.06)",
    border: "1px solid rgba(176,69,69,.25)",
    borderRadius: 10,
    fontSize: "var(--text-sm)",
    color: "var(--danger)",
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const minRem = m % 60;
  if (h < 24) return minRem > 0 ? `${h}h ${minRem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hRem = h % 24;
  return hRem > 0 ? `${d}d ${hRem}h ${minRem}m` : `${d}d`;
}

function fmtDateTime(iso: string): string {
  if (!iso || iso === "unknown") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const dayDiff = Math.round((+startOfDay(today) - +startOfDay(d)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return `${time}  today`;
  if (dayDiff === 1) return `${time}  yesterday`;
  return `${time}  ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
