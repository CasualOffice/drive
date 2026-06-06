/**
 * Storage section — read-only readout of the configured storage backend.
 * Quota math arrives once `/api/storage/usage` lands (see PIPELINE.md §6.4).
 */
import { useEffect, useState } from "react";
import { HardDrive, Server } from "lucide-react";

import { me as fetchMe, type Me } from "../../api/client.ts";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";

export function StorageSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchMe().then(setMe).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  return (
    <>
      <SettingsHeader
        title="Storage"
        description="The storage backend Drive is using to keep your files, plus per-workspace quota when set."
      />

      <SettingsCard
        title="Backend"
        subtitle="Configured at boot via DRIVE_STORAGE_BACKEND. Switching backends requires a restart."
      >
        {err ? (
          <Inline danger>{err}</Inline>
        ) : !me ? (
          <Skeleton />
        ) : (
          <ReadoutRow
            icon={<Server size={16} strokeWidth={1.7} />}
            label="Backend in use"
            value={me.backend}
          />
        )}
      </SettingsCard>

      <SettingsCard
        title="Usage"
        subtitle="Per-workspace quota and live usage. Quota enforcement lands in v0.2."
      >
        <ReadoutRow
          icon={<HardDrive size={16} strokeWidth={1.7} />}
          label="Used"
          value="—"
          hint="Live counter ships in v0.2."
        />
        <ReadoutRow
          icon={<HardDrive size={16} strokeWidth={1.7} />}
          label="Quota"
          value="Unlimited"
          hint="Per-workspace quotas ship in v0.2."
        />
      </SettingsCard>
    </>
  );
}

function ReadoutRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 4px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "var(--bg-subtle)",
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>{label}</div>
        <div className="tabular-nums" style={{ fontSize: "var(--text-md)", fontWeight: 500, color: "var(--ink)" }}>
          {value}
        </div>
        {hint && (
          <div style={{ marginTop: 2, fontSize: "var(--text-xs)", color: "var(--muted-2)" }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div
      style={{
        height: 52,
        borderRadius: 10,
        background: "linear-gradient(90deg, var(--bg-subtle), var(--card) 40%, var(--bg-subtle))",
        backgroundSize: "200% 100%",
        animation: "cd-skeleton 1.4s linear infinite",
      }}
    />
  );
}

function Inline({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: danger ? "rgba(178,36,36,.06)" : "var(--bg-subtle)",
        border: `1px solid ${danger ? "rgba(178,36,36,.25)" : "var(--line)"}`,
        borderRadius: 10,
        fontSize: "var(--text-sm)",
        color: danger ? "var(--danger, #B22424)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
