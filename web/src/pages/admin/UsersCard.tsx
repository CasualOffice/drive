/**
 * Admin → Users — list every user, set per-user quota inline, create
 * new users via a small dialog. Lists pending quota-upgrade requests
 * pulled from the activity feed and exposes one-click approve actions
 * that set the requested cap.
 *
 * Dense on-system restyle (docs/design/ui-system.md): 32px table rows,
 * hairline rules, mono/tabular numerics, amber primary, one Lucide weight.
 * Logic + endpoints unchanged.
 */
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpCircle, Check, Pencil, Plus, ShieldCheck, UserCircle, X } from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  createAdminUser,
  getActivity,
  listAdminUsers,
  setUserQuota,
  type ActivityEvent,
  type AdminUser,
} from "../../api/client.ts";
import { StatusChip } from "../../components/ds/StatusChip.tsx";
import { Button, ErrorBand, Field, STROKE } from "../settings/controls.tsx";

export function UsersCard() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [requests, setRequests] = useState<UpgradeRequest[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const [u, a] = await Promise.all([listAdminUsers(), getActivity(null, 50)]);
      setUsers(u.users);
      setRequests(collectUpgradeRequests(a.events, u.users));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) setErr("Admin access required.");
      else setErr(err.message ?? "Couldn't load users.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (err) return <Notice>{err}</Notice>;

  return (
    <>
      <Card
        title="Users"
        subtitle="Every account on this instance. Set a per-user storage cap by editing the Quota column."
        action={
          <Button type="button" variant="primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} strokeWidth={STROKE} />
            Add user
          </Button>
        }
      >
        {users === null ? (
          <Skeleton rows={3} />
        ) : users.length === 0 ? (
          <Empty>No users yet.</Empty>
        ) : (
          <UsersTable users={users} onChanged={refresh} />
        )}
      </Card>

      <Card
        title="Quota upgrade requests"
        subtitle="When a user clicks 'Request upgrade' in Settings → Storage, the request lands here."
      >
        {requests.length === 0 ? (
          <Empty>No pending requests.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {requests.map((r) => (
              <UpgradeRequestRow key={r.id} request={r} onApproved={refresh} />
            ))}
          </ul>
        )}
      </Card>

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void refresh()} />
    </>
  );
}

// ── Users table ─────────────────────────────────────────────────────────

const GRID = "1.8fr 1fr 1fr 1.3fr 56px";

function UsersTable({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  return (
    <div>
      <div
        className="caps-label"
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: "var(--space-3)",
          padding: "0 0 var(--space-1)",
          borderBottom: "1px solid var(--border-hair)",
        }}
      >
        <span>User</span>
        <span>Created</span>
        <span style={{ textAlign: "right" }}>Used</span>
        <span style={{ textAlign: "right" }}>Quota</span>
        <span />
      </div>
      {users.map((u) => (
        <UserRow key={u.id} user={u} onChanged={onChanged} />
      ))}
    </div>
  );
}

function UserRow({ user, onChanged }: { user: AdminUser; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user.quota_bytes ? bytesToMb(user.quota_bytes).toString() : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const parsed = value.trim();
      const next = parsed === "" ? null : mbToBytes(Number.parseFloat(parsed));
      if (next !== null && (Number.isNaN(next) || next < 0)) {
        toast.error("Quota must be a positive number of MB or blank for unlimited.");
        setSaving(false);
        return;
      }
      await setUserQuota(user.id, next);
      toast.success(`Quota updated for ${user.username}`);
      setEditing(false);
      onChanged();
    } catch {
      toast.error("Couldn't update quota.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: "var(--space-3)",
        minHeight: 32,
        padding: "var(--space-1) 0",
        alignItems: "center",
        borderBottom: "1px solid var(--border-hair)",
        fontSize: "var(--text-sm)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: "var(--radius-sm)",
            background: user.is_admin ? "var(--accent-wash)" : "var(--bg-sunken)",
            color: user.is_admin ? "var(--amber-700)" : "var(--fg-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {user.is_admin ? <ShieldCheck size={13} strokeWidth={STROKE} /> : <UserCircle size={13} strokeWidth={STROKE} />}
        </span>
        <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)", overflow: "hidden" }}>
          <span
            style={{
              fontWeight: "var(--weight-medium)",
              color: "var(--fg-default)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user.username}
          </span>
          {user.is_admin && (
            <StatusChip tone="verified" icon={<ShieldCheck size={12} strokeWidth={STROKE} />} label="Admin" />
          )}
        </span>
      </span>
      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>{fmtDate(user.created_at)}</span>
      <span className="tnum" style={{ textAlign: "right", color: "var(--fg-default)" }}>{fmtBytes(user.used_bytes)}</span>
      <span
        className="tnum"
        style={{ textAlign: "right", color: user.quota_bytes ? "var(--fg-default)" : "var(--fg-muted)" }}
      >
        {editing ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="MB"
              aria-label="Quota in MB"
              style={inlineInput}
            />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>MB</span>
          </span>
        ) : user.quota_bytes ? (
          fmtBytes(user.quota_bytes)
        ) : (
          "Unlimited"
        )}
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
        {editing ? (
          <>
            <IconBtn onClick={() => void save()} disabled={saving} label="Save quota">
              <Check size={13} strokeWidth={2} />
            </IconBtn>
            <IconBtn onClick={() => setEditing(false)} label="Cancel">
              <X size={13} strokeWidth={STROKE} />
            </IconBtn>
          </>
        ) : (
          <IconBtn onClick={() => setEditing(true)} label="Edit quota">
            <Pencil size={12} strokeWidth={STROKE} />
          </IconBtn>
        )}
      </span>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 24,
        height: 24,
        border: "1px solid var(--border-hair)",
        background: "var(--bg-raised)",
        color: "var(--fg-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: "var(--radius-sm)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

// ── Upgrade-request list ────────────────────────────────────────────────

interface UpgradeRequest {
  id: string;
  user_id: string;
  username: string;
  requested_bytes: number | null;
  reason: string | null;
  at: string;
  user_exists: boolean;
}

function collectUpgradeRequests(events: ActivityEvent[], users: AdminUser[]): UpgradeRequest[] {
  return events
    .filter((e) => e.action === "quota.upgrade_request")
    .slice(0, 10)
    .map((e) => {
      let requested_bytes: number | null = null;
      let reason: string | null = null;
      if (e.metadata) {
        try {
          const m = JSON.parse(e.metadata) as { requested_bytes?: number; reason?: string };
          if (typeof m.requested_bytes === "number") requested_bytes = m.requested_bytes;
          if (typeof m.reason === "string") reason = m.reason;
        } catch {
          /* ignored */
        }
      }
      const user_exists = users.some((u) => u.id === (e.actor_id ?? e.target_id));
      return {
        id: e.id,
        user_id: e.actor_id ?? e.target_id ?? "",
        username: e.actor_username ?? e.target_name ?? "(unknown)",
        requested_bytes,
        reason,
        at: e.created_at,
        user_exists,
      };
    });
}

function UpgradeRequestRow({ request, onApproved }: { request: UpgradeRequest; onApproved: () => void }) {
  const [busy, setBusy] = useState(false);

  async function approve() {
    if (!request.user_exists || busy || !request.requested_bytes) return;
    setBusy(true);
    try {
      await setUserQuota(request.user_id, request.requested_bytes);
      toast.success(`Approved — ${request.username} now has ${fmtBytes(request.requested_bytes)}`);
      onApproved();
    } catch {
      toast.error("Couldn't approve the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-wash)",
        borderLeft: "3px solid var(--status-attention)",
      }}
    >
      <ArrowUpCircle size={15} strokeWidth={STROKE} style={{ color: "var(--amber-700)", flexShrink: 0 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-default)" }}>
          <strong style={{ fontWeight: "var(--weight-medium)" }}>{request.username}</strong> requested
          {request.requested_bytes ? ` ${fmtBytes(request.requested_bytes)}` : " more storage"}
        </div>
        {request.reason && (
          <div style={{ marginTop: 2, fontSize: "var(--text-xs)", color: "var(--fg-muted)", fontStyle: "italic" }}>
            &ldquo;{request.reason}&rdquo;
          </div>
        )}
        <div className="tnum" style={{ fontSize: "var(--text-xs)", color: "var(--fg-subtle)", marginTop: 2 }}>
          {fmtRelative(request.at)}
        </div>
      </div>
      {request.requested_bytes && request.user_exists ? (
        <Button type="button" variant="primary" size="sm" onClick={() => void approve()} disabled={busy}>
          {busy ? "Approving…" : "Approve"}
        </Button>
      ) : (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--fg-subtle)" }}>
          {request.user_exists ? "no amount specified" : "user gone"}
        </span>
      )}
    </li>
  );
}

// ── Add-user dialog ─────────────────────────────────────────────────────

function AddUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [quotaMb, setQuotaMb] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      setQuotaMb("");
      setErr(null);
      setSubmitting(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErr(null);
    if (username.trim().length < 3) {
      setErr("Username must be at least 3 characters.");
      return;
    }
    if (password.length < 12) {
      setErr("Password must be at least 12 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const quota = quotaMb.trim() ? mbToBytes(Number.parseFloat(quotaMb)) : null;
      await createAdminUser({ username: username.trim(), password, is_admin: isAdmin, quota_bytes: quota });
      toast.success(`Created ${username.trim()}`);
      onCreated();
      onClose();
    } catch (e) {
      const ee = e as ApiError;
      const body = ee.body as { error?: string } | null;
      setErr(body?.error ?? "Couldn't create user.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay style={overlay} />
        <Dialog.Content style={dialog} aria-describedby="add-user-desc">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Dialog.Title style={dialogTitle}>Add user</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" style={closeBtn}>
                <X size={16} strokeWidth={STROKE} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description
            id="add-user-desc"
            style={{ margin: "var(--space-1) 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}
          >
            A Personal workspace is auto-created. Storage cap is optional — leave blank for unlimited.
          </Dialog.Description>

          <form onSubmit={submit}>
            <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <Field
              label="Storage cap (MB) — leave blank for unlimited"
              value={quotaMb}
              onChange={(e) => setQuotaMb(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 1024"
            />
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontSize: "var(--text-sm)",
                color: "var(--fg-default)",
                marginBottom: "var(--space-3)",
              }}
            >
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
              Workspace administrator
            </label>

            {err && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                <ErrorBand>{err}</ErrorBand>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting} aria-busy={submitting}>
                {submitting ? "Creating…" : "Create"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── primitives ──────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        padding: "var(--space-4)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-lg)",
            fontWeight: "var(--weight-bold)",
            color: "var(--fg-default)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {title}
        </h3>
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

function Skeleton({ rows }: { rows: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 32, borderRadius: "var(--radius-sm)" }} />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "var(--space-3) 0", fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{children}</div>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        padding: "var(--space-4)",
        textAlign: "center",
        color: "var(--fg-muted)",
        fontSize: "var(--text-sm)",
      }}
    >
      {children}
    </section>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const inlineInput: React.CSSProperties = {
  width: 68,
  height: 26,
  padding: "0 var(--space-2)",
  border: "var(--border-w) solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-sunken)",
  color: "var(--fg-default)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-xs)",
  textAlign: "right",
  outline: "none",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg-overlay)",
  zIndex: 1200,
  animation: "cd-fade-in var(--dur-base) var(--ease)",
};

const dialog: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(440px, 92vw)",
  background: "var(--bg-raised)",
  border: "1px solid var(--border-hair)",
  borderRadius: "var(--radius-xl)",
  padding: "var(--space-5)",
  boxShadow: "var(--shadow-lg)",
  zIndex: 1300,
  animation: "cd-modal-in var(--dur-base) var(--ease)",
};

const dialogTitle: React.CSSProperties = {
  margin: 0,
  fontSize: "var(--text-lg)",
  fontWeight: "var(--weight-semibold)",
  letterSpacing: "var(--tracking-tight)",
  color: "var(--fg-default)",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--fg-muted)",
  padding: 4,
  borderRadius: "var(--radius-sm)",
  display: "inline-flex",
};

// ── helpers ─────────────────────────────────────────────────────────────

function bytesToMb(b: number): number {
  return Math.round((b / (1024 * 1024)) * 100) / 100;
}
function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 * 1024);
}
function fmtBytes(b: number): string {
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
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
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
  return `${days}d ago`;
}
