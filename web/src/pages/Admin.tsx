/**
 * Admin dashboard. Spec: docs/ux/11-admin-surface.md + docs/design/ui-system.md.
 *
 * A single scrollable page of stat-rich cards — no nested nav (an operator
 * debugging an incident wants every datapoint at once). The compliance
 * controls (key management, integrity, retention & legal hold, signed audit
 * export) are the hub's admin reason-to-exist: surfaced as first-class tiles.
 * Where their endpoints don't yet exist they render honest "coming soon"
 * affordances — never fabricated counts. Read-only system data is unchanged
 * (getAdminSystem → /api/admin/system).
 */
import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  FileCheck2,
  Gavel,
  HardDrive,
  KeyRound,
  Link as LinkIcon,
  Lock,
  ScrollText,
  ShieldCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { ApiError, getAdminSystem, type AdminSystem } from "../api/client.ts";
import { StatusChip } from "../components/ds/StatusChip.tsx";
import { Button, STROKE } from "./settings/controls.tsx";
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
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg-canvas)", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <Header />

        {state.kind === "loading" && <Skeletons />}
        {state.kind === "forbidden" && <ForbiddenNotice />}
        {state.kind === "error" && (
          <div role="alert" style={errBox}>{state.message}</div>
        )}
        {state.kind === "ready" && <Body system={state.system} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: "var(--space-5)" }}>
      <h1
        style={{
          margin: 0,
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--fg-default)",
        }}
      >
        Admin
      </h1>
      <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
        How this Doc-Hub instance is configured, keyed, and governed.
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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <SystemCard system={system} />
      <UsersCard />
      <EncryptionCard />
      <IntegrityCard />
      <RetentionCard />
      <AuditExportCard onNavigate={onNavigate} />
      <StorageCard system={system} />
      <SessionsCard system={system} />
      <RecentSignInsCard system={system} onNavigate={onNavigate} />
    </div>
  );
}

// ── System card ────────────────────────────────────────────────────────

function SystemCard({ system }: { system: AdminSystem }) {
  return (
    <Card
      title="System"
      status={
        system.healthy ? (
          <StatusChip tone="verified" icon={<ShieldCheck size={13} strokeWidth={STROKE} />} label="Healthy" />
        ) : (
          <StatusChip
            tone="attention"
            icon={<ShieldCheck size={13} strokeWidth={STROKE} />}
            label="Degraded"
            title="Storage, database, or the key service is reporting trouble."
          />
        )
      }
    >
      <Grid>
        <Stat label="Uptime" value={fmtDuration(system.uptime_seconds)} />
        <Stat label="Version" value={`${system.version}${system.git_sha !== "unknown" ? ` · ${system.git_sha}` : ""}`} mono />
        <Stat label="Built" value={fmtDateTime(system.built_at)} />
        <Stat label="Storage backend" value={system.storage_backend} />
        <Stat label="Database" value={system.db_backend} />
        <Stat label="Active sessions" value={String(system.active_sessions)} />
      </Grid>
    </Card>
  );
}

// ── Compliance tiles (endpoints not yet wired → honest coming-soon) ──────

function EncryptionCard() {
  return (
    <ComingSoonCard
      title="Encryption & keys"
      icon={KeyRound}
      description="Master-key source + reachability, wrapped-DEK count, and last KEK rotation. Rotating re-wraps every data key without rewriting document blobs — documents stay readable throughout."
      actions={["Rotate master key", "Re-wrap DEKs"]}
      note="Key material is never rendered, returned, or logged. Lands with the admin key endpoints."
    />
  );
}

function IntegrityCard() {
  return (
    <ComingSoonCard
      title="Integrity"
      icon={FileCheck2}
      description="Version-chain and audit-chain health across the instance, with a full verify_chain sweep. A tamper alarm turns danger, deep-links the affected document's history, and is never auto-cleared."
      actions={["Verify now"]}
      note="Per-document verification is live on the version-history surface; the instance-wide sweep endpoint is pending."
    />
  );
}

function RetentionCard() {
  return (
    <ComingSoonCard
      title="Retention & legal hold"
      icon={Gavel}
      description="Retention policies, held documents, and purge-eligible tombstones. A legal hold blocks tombstone + purge on any path until released; releasing is itself an audited, chained event."
      actions={["Manage policies", "Manage holds", "Review purges"]}
      note="Wires to /api/retention and /api/holds when they land. No path here can rewrite history."
    />
  );
}

function AuditExportCard({ onNavigate }: { onNavigate: (target: "activity") => void }) {
  return (
    <Card
      title="Audit log"
      status={<StatusChip tone="info" icon={<ScrollText size={13} strokeWidth={STROKE} />} label="Append-only" />}
      action={
        <Button type="button" variant="secondary" onClick={() => onNavigate("activity")}>
          <ActivityIcon size={14} strokeWidth={STROKE} />
          Open audit log
        </Button>
      }
      subtitle="Append-only and hash-chained; committed rows are never updated or deleted."
    >
      <TileBody
        note="A signed, offline-verifiable report (date range + JSONL / CSV / PDF, chain head + Ed25519 signature over the range) lands with the export endpoint."
        actions={["Export signed report"]}
      />
    </Card>
  );
}

// ── Storage card ───────────────────────────────────────────────────────

function StorageCard({ system }: { system: AdminSystem }) {
  const { fs_root, s3_bucket, s3_endpoint, s3_region } = system.storage_config;
  return (
    <Card
      title="Storage adapter"
      subtitle="Configured at boot via DOCHUB_STORAGE_BACKEND. Switching backends requires a restart."
    >
      <Row icon={<HardDrive size={15} strokeWidth={STROKE} />} label="Backend" value={system.storage_backend} />
      {fs_root && <Row icon={<HardDrive size={15} strokeWidth={STROKE} />} label="Filesystem root" value={fs_root} mono />}
      {s3_bucket && (
        <>
          <Row icon={<HardDrive size={15} strokeWidth={STROKE} />} label="S3 bucket" value={s3_bucket} mono />
          {s3_region && <Row icon={<HardDrive size={15} strokeWidth={STROKE} />} label="Region" value={s3_region} />}
          {s3_endpoint && <Row icon={<HardDrive size={15} strokeWidth={STROKE} />} label="Endpoint" value={s3_endpoint} mono last />}
        </>
      )}
      {!fs_root && !s3_bucket && (
        <div style={{ padding: "var(--space-2) 0", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
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
      <Row icon={<Users size={15} strokeWidth={STROKE} />} label="Active sessions" value={String(system.active_sessions)} last />
      <div style={{ marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
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
    <Card title="Recent sign-ins" subtitle="Latest 10 events from the audit log.">
      {system.recent_sign_ins.length === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>No sign-in events recorded yet.</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {system.recent_sign_ins.map((s, i) => (
            <li
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                alignItems: "center",
                gap: "var(--space-3)",
                minHeight: 32,
                padding: "var(--space-1) 0",
                borderBottom: i === system.recent_sign_ins.length - 1 ? "none" : "1px solid var(--border-hair)",
              }}
            >
              <span aria-hidden style={{ display: "inline-flex" }}>
                {s.ok ? (
                  <ShieldCheck size={14} strokeWidth={STROKE} style={{ color: "var(--status-verified-700)" }} />
                ) : (
                  <XCircle size={14} strokeWidth={STROKE} style={{ color: "var(--status-danger-700)" }} />
                )}
              </span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-default)" }}>
                {s.ok ? "" : <span style={{ color: "var(--status-danger-700)" }}>failed · </span>}
                {s.actor_username ?? "(unknown)"}
              </span>
              <span className="tnum" style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
                {fmtRelativeTime(s.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-3)" }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate("activity")}>
          <ActivityIcon size={13} strokeWidth={STROKE} />
          Open audit log
        </Button>
      </div>
    </Card>
  );
}

// ── Skeletons / states ─────────────────────────────────────────────────

function Skeletons() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton" style={{ height: 120, borderRadius: "var(--radius-lg)" }} />
      ))}
    </div>
  );
}

function ForbiddenNotice() {
  return (
    <div
      style={{
        padding: "var(--space-8) var(--space-6)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-lg)",
        textAlign: "center",
      }}
    >
      <div style={{ color: "var(--fg-subtle)", marginBottom: "var(--space-2)", display: "flex", justifyContent: "center" }}>
        <Lock size={22} strokeWidth={STROKE} />
      </div>
      <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--fg-default)" }}>
        Admin access required.
      </h2>
      <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
        Ask your workspace owner to promote your account, or sign in as an admin.
      </p>
    </div>
  );
}

// ── primitives ─────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  status,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-4)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: "var(--text-lg)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--fg-default)",
              letterSpacing: "var(--tracking-tight)",
            }}
          >
            {title}
          </h3>
          {status}
        </div>
        {action}
      </div>
      {subtitle && (
        <p style={{ margin: "var(--space-1) 0 0", fontSize: "var(--text-sm)", color: "var(--fg-muted)", lineHeight: "var(--leading-sm)" }}>
          {subtitle}
        </p>
      )}
      <div style={{ marginTop: "var(--space-4)" }}>{children}</div>
    </section>
  );
}

function ComingSoonCard({
  title,
  icon: Icon,
  description,
  actions,
  note,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  actions: string[];
  note: string;
}) {
  return (
    <Card
      title={title}
      status={<StatusChip tone="info" icon={<Icon size={13} strokeWidth={STROKE} />} label="Coming soon" />}
    >
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--fg-muted)", lineHeight: "var(--leading-md)" }}>
        {description}
      </p>
      <TileBody actions={actions} note={note} />
    </Card>
  );
}

/** Shared body for compliance tiles: the spec's affordances (disabled) + a note. */
function TileBody({ actions, note }: { actions: string[]; note: string }) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        {actions.map((a) => (
          <Button key={a} type="button" variant="secondary" disabled title="Not yet wired">
            {a}
          </Button>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-2)",
          marginTop: "var(--space-3)",
          fontSize: "var(--text-xs)",
          color: "var(--fg-muted)",
          lineHeight: "var(--leading-sm)",
        }}
      >
        <LinkIcon size={12} strokeWidth={STROKE} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{note}</span>
      </div>
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-3) var(--space-6)" }}>
      {children}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{label}</div>
      <div
        className={mono ? "mono" : "tnum"}
        style={{ marginTop: 2, fontSize: mono ? "var(--mono-sm)" : "var(--text-md)", color: "var(--fg-default)", fontWeight: "var(--weight-medium)" }}
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
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 140px 1fr",
        alignItems: "center",
        gap: "var(--space-3)",
        minHeight: 32,
        padding: "var(--space-1) 0",
        borderBottom: last ? "none" : "1px solid var(--border-hair)",
      }}
    >
      <span aria-hidden style={{ color: "var(--fg-subtle)", display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{label}</span>
      <span
        className={mono ? "mono" : undefined}
        style={{
          fontSize: mono ? "var(--mono-sm)" : "var(--text-sm)",
          color: "var(--fg-default)",
          fontWeight: "var(--weight-medium)",
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

const errBox: React.CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  background: "rgba(163,44,34,0.06)",
  border: "1px solid var(--status-danger-700)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  color: "var(--fg-default)",
};

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
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
