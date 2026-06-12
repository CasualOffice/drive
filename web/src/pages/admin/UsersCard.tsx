/**
 * Admin → Users — list every user, set per-user quota inline, create
 * new users via a small dialog. Lists pending quota-upgrade requests
 * pulled from the activity feed and exposes one-click approve actions
 * that set the requested cap.
 */
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUpCircle,
  Check,
  Pencil,
  Plus,
  ShieldCheck,
  UserCircle,
  X,
} from "lucide-react";
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
      if (err.status === 403) {
        setErr("Admin access required.");
      } else {
        setErr(err.message ?? "Couldn't load users.");
      }
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
          <button type="button" onClick={() => setAddOpen(true)} style={addBtn()}>
            <Plus size={14} strokeWidth={2} />
            Add user
          </button>
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
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {requests.map((r) => (
              <UpgradeRequestRow key={r.id} request={r} onApproved={refresh} />
            ))}
          </ul>
        )}
      </Card>

      <AddUserDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => void refresh()}
      />
    </>
  );
}

// ── Users table ─────────────────────────────────────────────────────────

function UsersTable({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  return (
    <div>
      <div style={headerRow()}>
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
  const [value, setValue] = useState(
    user.quota_bytes ? bytesToMb(user.quota_bytes).toString() : "",
  );
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
    <div style={dataRow()}>
      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={avatarSquare(user.is_admin)}>
          {user.is_admin ? (
            <ShieldCheck size={13} strokeWidth={1.8} />
          ) : (
            <UserCircle size={13} strokeWidth={1.8} />
          )}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ fontWeight: 500, color: "var(--ink)" }}>{user.username}</span>
          {user.is_admin && (
            <span style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)" }}>ADMIN</span>
          )}
        </span>
      </span>
      <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>
        {fmtDate(user.created_at)}
      </span>
      <span className="tabular-nums" style={{ textAlign: "right", color: "var(--ink)" }}>
        {fmtBytes(user.used_bytes)}
      </span>
      <span
        className="tabular-nums"
        style={{ textAlign: "right", color: user.quota_bytes ? "var(--ink)" : "var(--muted)" }}
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
              style={inlineInput()}
            />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>MB</span>
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
            <button type="button" onClick={() => void save()} disabled={saving} style={iconBtn(true)}>
              <Check size={13} strokeWidth={2.2} />
            </button>
            <button type="button" onClick={() => setEditing(false)} style={iconBtn()}>
              <X size={13} strokeWidth={2} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={iconBtn()}
            title="Edit quota"
          >
            <Pencil size={12} strokeWidth={1.8} />
          </button>
        )}
      </span>
    </div>
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
          const m = JSON.parse(e.metadata) as {
            requested_bytes?: number;
            reason?: string;
          };
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

function UpgradeRequestRow({
  request,
  onApproved,
}: {
  request: UpgradeRequest;
  onApproved: () => void;
}) {
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
    <li style={requestRow()}>
      <span style={{ color: "var(--accent)", marginTop: 2 }}>
        <ArrowUpCircle size={15} strokeWidth={1.8} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
          <strong style={{ fontWeight: 500 }}>{request.username}</strong> requested
          {request.requested_bytes
            ? ` ${fmtBytes(request.requested_bytes)}`
            : " more storage"}
        </div>
        {request.reason && (
          <div
            style={{
              marginTop: 2,
              fontSize: "var(--text-xs)",
              color: "var(--muted)",
              fontStyle: "italic",
            }}
          >
            &ldquo;{request.reason}&rdquo;
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>
          {fmtRelative(request.at)}
        </div>
      </div>
      {request.requested_bytes && request.user_exists ? (
        <button
          type="button"
          onClick={() => void approve()}
          disabled={busy}
          style={approveBtn()}
        >
          {busy ? "Approving…" : "Approve"}
        </button>
      ) : (
        <span style={{ fontSize: 11, color: "var(--muted-2)" }}>
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
      const quota = quotaMb.trim()
        ? mbToBytes(Number.parseFloat(quotaMb))
        : null;
      await createAdminUser({
        username: username.trim(),
        password,
        is_admin: isAdmin,
        quota_bytes: quota,
      });
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
        <Dialog.Overlay style={overlay()} />
        <Dialog.Content style={dialog()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Dialog.Title style={dialogTitle()}>Add user</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" style={closeBtn()}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description
            style={{ margin: "4px 0 18px", fontSize: "var(--text-sm)", color: "var(--muted)" }}
          >
            A Personal workspace is auto-created. Storage cap is optional —
            leave blank for unlimited.
          </Dialog.Description>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Username">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                style={field()}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                style={field()}
              />
            </Field>
            <Field label="Storage cap (MB) — leave blank for unlimited">
              <input
                value={quotaMb}
                onChange={(e) => setQuotaMb(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 1024"
                style={field()}
              />
            </Field>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
              />
              Workspace administrator
            </label>

            {err && (
              <div role="alert" style={errBox()}>
                {err}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={onClose} style={ghostBtn()}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: "var(--text-sm)" }}>
      <span style={{ display: "block", marginBottom: 6, color: "var(--ink)", fontWeight: 500 }}>
        {label}
      </span>
      {children}
    </label>
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
        {action}
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

function Skeleton({ rows }: { rows: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 38,
            borderRadius: 8,
            background: "linear-gradient(90deg, var(--bg-subtle), var(--card) 40%, var(--bg-subtle))",
            backgroundSize: "200% 100%",
            animation: "cd-skeleton 1.4s linear infinite",
          }}
        />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 0", fontSize: "var(--text-sm)", color: "var(--muted)" }}>
      {children}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 22,
        textAlign: "center",
        color: "var(--muted)",
        fontSize: "var(--text-sm)",
      }}
    >
      {children}
    </section>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

function headerRow(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1.8fr 1fr 1fr 1.3fr 60px",
    gap: 14,
    padding: "0 4px 6px",
    fontSize: 10,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    color: "var(--muted-2)",
    fontWeight: 600,
    borderBottom: "1px solid var(--line)",
  };
}

function dataRow(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "1.8fr 1fr 1fr 1.3fr 60px",
    gap: 14,
    padding: "10px 4px",
    alignItems: "center",
    borderBottom: "1px solid var(--line)",
    fontSize: "var(--text-sm)",
  };
}

function avatarSquare(admin: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: admin ? "var(--accent-muted)" : "var(--bg-subtle)",
    color: admin ? "var(--accent)" : "var(--muted)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

function inlineInput(): React.CSSProperties {
  return {
    width: 70,
    padding: "4px 6px",
    border: "1px solid var(--line-strong)",
    borderRadius: 6,
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    textAlign: "right",
    outline: "none",
  };
}

function iconBtn(active = false): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    border: "1px solid var(--line)",
    background: active ? "var(--ink)" : "var(--paper)",
    color: active ? "var(--paper)" : "var(--muted)",
    cursor: "pointer",
    borderRadius: 6,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 120ms, color 120ms",
  };
}

function addBtn(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    background: "var(--ink)",
    color: "var(--paper)",
    border: "none",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
  };
}

function approveBtn(): React.CSSProperties {
  return {
    padding: "7px 12px",
    background: "var(--accent)",
    color: "var(--paper)",
    border: "none",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    fontWeight: 500,
    flexShrink: 0,
  };
}

function requestRow(): React.CSSProperties {
  return {
    display: "flex",
    gap: 11,
    padding: "11px 10px",
    borderRadius: 10,
    background: "var(--accent-muted)",
    border: "1px solid rgba(200,164,92,.32)",
    marginBottom: 8,
  };
}

function overlay(): React.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex: 90,
    animation: "cd-fade-in 200ms var(--ease)",
  };
}

function dialog(): React.CSSProperties {
  return {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(440px, 92vw)",
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 18,
    padding: "22px 24px 24px",
    boxShadow: "var(--shadow-xl)",
    zIndex: 91,
    animation: "cd-modal-in 240ms var(--ease)",
  };
}

function dialogTitle(): React.CSSProperties {
  return {
    margin: 0,
    fontFamily: "var(--font-display)",
    fontSize: "var(--text-xl)",
    fontWeight: 500,
    letterSpacing: "var(--tracking-tight)",
    color: "var(--ink)",
  };
}

function closeBtn(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--muted)",
    padding: 6,
    borderRadius: 8,
  };
}

function field(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--line)",
    borderRadius: 10,
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md)",
    outline: "none",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}

function primaryBtn(submitting: boolean): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 10,
    border: "none",
    background: submitting ? "var(--line-strong)" : "var(--ink)",
    color: "var(--paper)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: submitting ? "not-allowed" : "pointer",
  };
}

function errBox(): React.CSSProperties {
  return {
    padding: "9px 12px",
    background: "rgba(220, 38, 38,.06)",
    border: "1px solid rgba(220, 38, 38,.25)",
    borderRadius: 9,
    fontSize: "var(--text-sm)",
    color: "var(--danger)",
  };
}

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
