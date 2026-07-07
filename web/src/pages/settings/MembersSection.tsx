/**
 * Settings → Members section (MU1 Phase 1c).
 *
 * Spec: [[workspace-invitations]] memory entry §"Phase 1c — Members tab".
 *
 * Two stacked cards:
 *   1. **Active members** — read-only list (owner badge + joined date).
 *   2. **Pending invitations** — each row with its status (StatusChip) + a
 *      Revoke button for active ones. Owner mints a fresh invite from the
 *      WorkspaceSwitcher footer.
 *
 * Dense on-system restyle. Logic + endpoints unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import { Ban, Clock, Link2, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  listInvitations,
  listWorkspaceMembers,
  listWorkspaces,
  revokeInvitation,
  type InvitationListEntry,
  type Workspace,
  type WorkspaceMember,
} from "../../api/client.ts";
import { StatusChip, type StatusTone } from "../../components/ds/StatusChip.tsx";
import { useActiveWorkspaceId } from "../../state/WorkspaceContext.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { Button, STROKE } from "./controls.tsx";

export function MembersSection() {
  const workspaceId = useActiveWorkspaceId();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationListEntry[] | null>(null);
  const [confirming, setConfirming] = useState<InvitationListEntry | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [wsList, m, invs] = await Promise.all([
        listWorkspaces(),
        listWorkspaceMembers(workspaceId),
        listInvitations(workspaceId),
      ]);
      const ws = wsList.workspaces.find((w) => w.id === workspaceId) ?? null;
      setWorkspace(ws);
      setMembers(m.members);
      setInvitations(invs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't load workspace members";
      toast.error(message);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function doRevoke(inv: InvitationListEntry) {
    if (!workspaceId) return;
    try {
      await revokeInvitation(workspaceId, inv.id);
      toast.success("Invitation revoked");
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Revoke failed";
      toast.error(message);
    }
  }

  const isPersonal = workspace?.kind === "personal";

  return (
    <>
      <SettingsHeader
        title="Members"
        description="Who has access to this workspace and which invitations are still live."
      />

      {isPersonal ? (
        <SettingsCard title="Personal workspace">
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--fg-muted)", lineHeight: "var(--leading-md)" }}>
            This is your personal workspace — it's just for you. To collaborate, switch to a team
            workspace or create one from the workspace switcher in the sidebar.
          </p>
        </SettingsCard>
      ) : (
        <>
          <ActiveMembersCard members={members} workspace={workspace} />
          <PendingInvitationsCard invitations={invitations} onRevoke={(inv) => setConfirming(inv)} />
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="Revoke this invitation?"
        body="The link will stop admitting new members. Anyone who already accepted stays in the workspace."
        variant="destructive"
        confirmLabel="Revoke"
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          const target = confirming;
          setConfirming(null);
          if (target) await doRevoke(target);
        }}
      />
    </>
  );
}

function CountPill({ count }: { count: number | null }) {
  if (count === null) return null;
  return (
    <span
      className="tnum"
      style={{
        fontSize: "var(--text-xs)",
        color: "var(--fg-muted)",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-xs)",
        padding: "1px 6px",
      }}
    >
      {count}
    </span>
  );
}

function ActiveMembersCard({
  members,
  workspace,
}: {
  members: WorkspaceMember[] | null;
  workspace: Workspace | null;
}) {
  return (
    <SettingsCard title="Active" status={<CountPill count={members?.length ?? null} />}>
      {members === null ? (
        <Muted>Loading…</Muted>
      ) : members.length === 0 ? (
        <Muted>No members yet.</Muted>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {members.map((m, i) => (
            <MemberRow
              key={m.user_id}
              member={m}
              isOwner={workspace?.owner_id === m.user_id}
              last={i === members.length - 1}
            />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function MemberRow({
  member,
  isOwner,
  last,
}: {
  member: WorkspaceMember;
  isOwner: boolean;
  last: boolean;
}) {
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        minHeight: 32,
        padding: "var(--space-1) 0",
        borderBottom: last ? "none" : "1px solid var(--border-hair)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-sunken)",
          color: "var(--fg-muted)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: "var(--weight-medium)",
          fontSize: "var(--text-sm)",
          flexShrink: 0,
        }}
      >
        {member.username.charAt(0).toUpperCase()}
      </span>
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          color: "var(--fg-default)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {member.username}
      </span>
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: isOwner ? "var(--amber-700)" : "var(--fg-muted)",
          background: isOwner ? "var(--accent-wash)" : "var(--bg-sunken)",
          border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-xs)",
          padding: "1px 7px",
          textTransform: "capitalize",
        }}
      >
        {isOwner ? "Owner" : member.role}
      </span>
    </li>
  );
}

function PendingInvitationsCard({
  invitations,
  onRevoke,
}: {
  invitations: InvitationListEntry[] | null;
  onRevoke: (inv: InvitationListEntry) => void;
}) {
  const active = invitations?.filter((i) => !i.revoked) ?? [];
  return (
    <SettingsCard title="Pending invitations" status={<CountPill count={active.length} />}>
      {invitations === null ? (
        <Muted>Loading…</Muted>
      ) : invitations.length === 0 ? (
        <Muted>No invitations yet. Generate one from the workspace switcher in the sidebar.</Muted>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {invitations.map((inv, i) => (
            <InvitationRow
              key={inv.id}
              inv={inv}
              last={i === invitations.length - 1}
              onRevoke={() => onRevoke(inv)}
            />
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function InvitationRow({
  inv,
  last,
  onRevoke,
}: {
  inv: InvitationListEntry;
  last: boolean;
  onRevoke: () => void;
}) {
  const status = computeStatus(inv);
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) 0",
        borderBottom: last ? "none" : "1px solid var(--border-hair)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              color: "var(--fg-default)",
              textTransform: "capitalize",
            }}
          >
            {inv.role}
          </span>
          <StatusChip {...statusChip(status)} />
        </div>
        <div
          className="tnum"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--fg-muted)",
            marginTop: 2,
            display: "flex",
            gap: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          <span>{inv.used_count} / {inv.max_uses} used</span>
          <span aria-hidden>·</span>
          <span>{inv.expires_at ? `Expires ${formatRelative(inv.expires_at)}` : "Never expires"}</span>
          <span aria-hidden>·</span>
          <span>Created {formatRelative(inv.created_at)}</span>
        </div>
      </div>
      {status === "active" && (
        <Button type="button" variant="danger" size="sm" onClick={onRevoke} aria-label="Revoke invitation">
          <Trash2 size={12} strokeWidth={STROKE} />
          Revoke
        </Button>
      )}
    </li>
  );
}

type Status = "active" | "exhausted" | "expired" | "revoked";

function computeStatus(inv: InvitationListEntry): Status {
  if (inv.revoked) return "revoked";
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  if (inv.used_count >= inv.max_uses) return "exhausted";
  return "active";
}

function statusChip(status: Status): { tone: StatusTone; icon: React.ReactNode; label: string } {
  switch (status) {
    case "active":
      return { tone: "info", icon: <Link2 size={13} strokeWidth={STROKE} />, label: "Active" };
    case "exhausted":
      return { tone: "ambient", icon: <Ban size={13} strokeWidth={STROKE} />, label: "Exhausted" };
    case "expired":
      return { tone: "ambient", icon: <Clock size={13} strokeWidth={STROKE} />, label: "Expired" };
    case "revoked":
      return { tone: "danger", icon: <XCircle size={13} strokeWidth={STROKE} />, label: "Revoked" };
  }
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>{children}</p>;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "soon";
  const diffMs = t - Date.now();
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;
  const day = 1000 * 60 * 60 * 24;
  const hour = 1000 * 60 * 60;
  const min = 1000 * 60;
  if (abs >= 2 * day) {
    const days = Math.round(abs / day);
    return past ? `${days}d ago` : `in ${days}d`;
  }
  if (abs >= 2 * hour) {
    const hours = Math.round(abs / hour);
    return past ? `${hours}h ago` : `in ${hours}h`;
  }
  if (abs >= 2 * min) {
    const mins = Math.round(abs / min);
    return past ? `${mins}m ago` : `in ${mins}m`;
  }
  return past ? "just now" : "any moment";
}
