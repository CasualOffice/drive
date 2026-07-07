import type { ReactNode } from "react";

/**
 * StatusChip — the honest status affordance. Always renders icon + label
 * (or a title/aria-label when the label is visually omitted), so a status
 * is never carried by colour alone (ui-system §2.7, WCAG). Tones map to the
 * AA-safe `-700` text steps; `ambient` is the neutral non-alarm default
 * used by the vault Lock/Encryption cluster.
 */
export type StatusTone = "ambient" | "verified" | "attention" | "danger" | "info";

const TONE_FG: Record<StatusTone, string> = {
  ambient: "var(--fg-subtle)",
  verified: "var(--status-verified-700)",
  attention: "var(--status-attention-700)",
  danger: "var(--status-danger-700)",
  info: "var(--status-info-700)",
};

export function StatusChip({
  icon,
  label,
  tone = "ambient",
  title,
}: {
  icon: ReactNode;
  label: string;
  tone?: StatusTone;
  title?: string;
}) {
  return (
    <span
      title={title ?? label}
      aria-label={title ?? label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        maxWidth: "100%",
        color: TONE_FG[tone],
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ display: "inline-flex", flexShrink: 0 }}>
        {icon}
      </span>
      {label && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      )}
    </span>
  );
}
