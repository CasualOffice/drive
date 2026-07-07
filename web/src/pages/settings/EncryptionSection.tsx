/**
 * Encryption & keys section — read-only posture readout. Spec:
 * docs/ux/03-settings-surface.md §"Encryption & keys — detail" +
 * docs/design/ui-system.md §7.6 (encryption badge) / §8.3 (encrypted-at-rest
 * is ambient + permanent). Key *material* is never rendered — only the
 * scheme, the always-on status, and the honest trade-off copy.
 *
 * No master-key detail is exposed by the API (keys never appear in
 * responses), so source/rotation are described, not fabricated. The rotate
 * affordance is read-only here; the live control lands on the admin
 * key-management surface (docs/ux/11-admin-surface.md).
 */
import { KeyRound, Lock, ShieldCheck } from "lucide-react";

import { StatusChip } from "../../components/ds/StatusChip.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { Button, STROKE } from "./controls.tsx";

export function EncryptionSection() {
  return (
    <>
      <SettingsHeader
        title="Encryption & keys"
        description="How this hub protects documents at rest. Key material is never displayed, exported, or logged."
      />

      <SettingsCard
        title="Master key"
        status={
          <StatusChip
            tone="verified"
            icon={<ShieldCheck size={13} strokeWidth={STROKE} />}
            label="Active"
            title="Boot refuses to start without a master key — so it is always active."
          />
        }
        subtitle="The KEK that wraps every workspace data key. Configured at boot via DOCHUB_MASTER_KEY or a KMS provider."
        action={
          <Button type="button" variant="secondary" disabled title="Rotation runs from the admin key-management surface.">
            <KeyRound size={14} strokeWidth={STROKE} />
            Rotate master key
          </Button>
        }
      >
        <ReadoutRow icon={<KeyRound size={16} strokeWidth={STROKE} />} label="Source" value="Master key (env) or configured KMS" />
        <ReadoutRow icon={<Lock size={16} strokeWidth={STROKE} />} label="Algorithm" value="AES-256-GCM envelope" />
        <ReadoutRow
          icon={<ShieldCheck size={16} strokeWidth={STROKE} />}
          label="Rotation"
          value="Re-wraps data keys · blobs untouched"
          hint="Rotating derives a new KEK and re-wraps every workspace DEK without rewriting document blobs — documents stay readable throughout. Runs from the admin surface and is audited."
          last
        />
      </SettingsCard>

      <SettingsCard
        title="Workspace data keys"
        status={
          <StatusChip
            tone="verified"
            icon={<Lock size={13} strokeWidth={STROKE} />}
            label="Wrapped"
            title="Every workspace data key is wrapped by the master KEK — never stored or shown in plaintext."
          />
        }
        subtitle="Each workspace has its own data key (DEK), wrapped by the master KEK. There is no reveal and no export."
      >
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--fg-muted)", lineHeight: "var(--leading-md)" }}>
          Document bytes are encrypted with a per-workspace DEK before they reach any storage backend
          and decrypted only after they leave it. DEKs are always at rest wrapped by the master KEK.
        </p>
      </SettingsCard>

      <div
        style={{
          padding: "var(--space-3)",
          background: "var(--bg-sunken)",
          borderLeft: "3px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          fontSize: "var(--text-sm)",
          color: "var(--fg-muted)",
          lineHeight: "var(--leading-md)",
        }}
      >
        Encryption defends a stolen disk or database — not a compromised server. The server holds keys
        so it can index and reason over your documents. This is deliberate, and is not zero-knowledge
        end-to-end encryption.
      </div>
    </>
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
        alignItems: "flex-start",
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
        <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--fg-default)" }}>
          {value}
        </div>
        {hint && (
          <div style={{ marginTop: 2, fontSize: "var(--text-xs)", color: "var(--fg-muted)", lineHeight: "var(--leading-sm)" }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
