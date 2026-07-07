/**
 * Storage section — read-only readout of the configured storage backend.
 * Dense on-system restyle; StatusChip signals the live backend. Quota math
 * arrives once `/api/storage/usage` lands. Logic + endpoints unchanged.
 */
import { useEffect, useState } from "react";
import { ArrowUpCircle, Clock, HardDrive, Server } from "lucide-react";
import { toast } from "sonner";

import {
  type About,
  getAbout,
  me as fetchMe,
  requestQuotaUpgrade,
  type Me,
} from "../../api/client.ts";
import { StatusChip } from "../../components/ds/StatusChip.tsx";
import { WorkspaceStorageCard } from "../../components/WorkspaceStorageCard.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { Button, ErrorBand, STROKE } from "./controls.tsx";

export function StorageSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [about, setAbout] = useState<About | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe).catch((e) => setErr(String(e?.message ?? e)));
    getAbout().then(setAbout).catch(() => {
      /* about is informational — silent on failure */
    });
  }, []);

  return (
    <>
      <SettingsHeader
        title="Storage"
        description="The storage backend Doc-Hub is using to keep your documents, plus per-workspace quota when set."
      />

      <SettingsCard
        title="Backend"
        status={
          me ? (
            <StatusChip
              tone="verified"
              icon={<Server size={13} strokeWidth={STROKE} />}
              label={me.backend}
              title={`Storage backend in use: ${me.backend}`}
            />
          ) : undefined
        }
        subtitle="Configured at boot via DOCHUB_STORAGE_BACKEND. Switching backends requires a restart."
      >
        {err ? (
          <ErrorBand>{err}</ErrorBand>
        ) : !me ? (
          <Skeleton />
        ) : (
          <>
            <ReadoutRow
              icon={<Server size={16} strokeWidth={STROKE} />}
              label="Backend in use"
              value={me.backend}
            />
            <ReadoutRow
              icon={<Clock size={16} strokeWidth={STROKE} />}
              label="Signed-URL lifetime"
              value={about ? formatTtl(about.signed_url_ttl_secs) : "—"}
              hint="How long a /download link stays valid before the server re-signs. Set via DOCHUB_SIGNED_URL_TTL_SECS."
              last
            />
          </>
        )}
      </SettingsCard>

      <SettingsCard title="Usage" subtitle="Live storage consumed by your non-trashed documents.">
        {!me ? (
          <Skeleton />
        ) : (
          <>
            <ReadoutRow
              icon={<HardDrive size={16} strokeWidth={STROKE} />}
              label="Used"
              value={typeof me.used_bytes === "number" ? formatBytes(me.used_bytes) : "—"}
            />
            <ReadoutRow
              icon={<HardDrive size={16} strokeWidth={STROKE} />}
              label="Quota"
              value={
                me.quota_bytes && me.quota_bytes > 0
                  ? formatBytes(me.quota_bytes)
                  : "Unlimited"
              }
              hint={
                me.quota_bytes
                  ? `${pctUsed(me.used_bytes, me.quota_bytes)}% used`
                  : "An admin can allocate a cap via the Admin → Users surface."
              }
              last
            />
            {me.quota_bytes && me.quota_bytes > 0 && (
              <RequestUpgradeRow currentQuota={me.quota_bytes} />
            )}
          </>
        )}
      </SettingsCard>

      <WorkspaceStorageCard />
    </>
  );
}

function RequestUpgradeRow({ currentQuota }: { currentQuota: number }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (busy || sent) return;
    setBusy(true);
    try {
      // Suggest doubling the current cap as a reasonable default.
      await requestQuotaUpgrade(currentQuota * 2);
      setSent(true);
      toast.success("Request sent to your admin", {
        description: "It'll show up in their Activity feed.",
      });
    } catch {
      toast.error("Couldn't send the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "var(--space-3)",
        padding: "var(--space-3)",
        background: "var(--accent-wash)",
        borderLeft: "3px solid var(--status-attention)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
      }}
    >
      <ArrowUpCircle size={16} strokeWidth={STROKE} style={{ color: "var(--amber-700)", flexShrink: 0 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-medium)", color: "var(--fg-default)" }}>
          Need more storage?
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
          Send a request — your admin sees it in the Activity feed and can raise your cap from Admin → Users.
        </div>
      </div>
      <Button
        type="button"
        variant="primary"
        onClick={() => void submit()}
        disabled={busy || sent}
      >
        {sent ? "Sent" : busy ? "Sending…" : "Request upgrade"}
      </Button>
    </div>
  );
}

function ReadoutRow({
  icon,
  label,
  value,
  hint,
  last,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) 0",
        borderBottom: last ? "none" : "1px solid var(--border-hair)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-sunken)",
          color: "var(--fg-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{label}</div>
        <div className="tnum" style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--fg-default)" }}>
          {value}
        </div>
        {hint && (
          <div style={{ marginTop: 2, fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="skeleton" style={{ height: 52, borderRadius: "var(--radius-md)" }} />;
}

function formatTtl(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${secs} sec`;
  if (secs < 3600) {
    const m = Math.round(secs / 60);
    return `${m} min`;
  }
  const h = Math.round((secs / 3600) * 10) / 10;
  return `${h} h`;
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

function pctUsed(used: number | undefined, quota: number | null | undefined): number {
  if (!used || !quota || quota <= 0) return 0;
  return Math.round((used / quota) * 100);
}
