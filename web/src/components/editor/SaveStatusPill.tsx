/**
 * SaveStatusPill — Google-Docs-style "Saving…", "Saved 2 min ago",
 * "Save failed" indicator. Rendered in the `<FileFullscreen>` header
 * for both `.docx` and `.xlsx` editor surfaces.
 *
 * Ticks every 30 s so the relative-time label stays accurate without
 * the host having to re-render the whole route. Renders nothing in
 * the `idle` state — fresh routes shouldn't surface chrome that
 * promises a save the user hasn't asked for.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";

import type { SaveStatus } from "./save-status.ts";

interface Props {
  status: SaveStatus;
}

export function SaveStatusPill({ status }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status.kind !== "saved") return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [status.kind]);

  if (status.kind === "idle") return null;

  // Neobrutalist pill: 2px ink border + small hard offset shadow. The
  // signal colour tints the icon (and the fill for the live "saving"
  // state) — violet for the saving/saved signal, danger for a failure.
  const failed = status.kind === "failed";
  const [icon, label, signal] =
    status.kind === "saving"
      ? [<Loader2 key="i" size={13} className="cd-save-spin" />, "Saving…", "var(--violet-500)"]
      : status.kind === "saved"
        ? [
            <Check key="i" size={13} strokeWidth={2.4} />,
            status.version != null
              ? `Saved as v${status.version}`
              : `Saved ${formatAgo(now - status.at)}`,
            "var(--violet-500)",
          ]
        : [<AlertCircle key="i" size={13} strokeWidth={2.4} />, "Save failed", "var(--danger)"];

  return (
    <div
      data-testid="file-fullscreen-save-status"
      data-save-kind={status.kind}
      title={status.kind === "failed" ? status.message : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 9px",
        borderRadius: "var(--radius-xs)",
        border: "var(--border-w) solid var(--border)",
        boxShadow: "var(--shadow-sm)",
        background: status.kind === "saving" ? "var(--violet-100)" : "var(--bg-surface)",
        color: failed ? "var(--danger)" : "var(--ink)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-semibold)",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ display: "inline-flex", color: signal }}>
        {icon}
      </span>
      {label}
      <style>{`
        @keyframes cd-save-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .cd-save-spin { animation: cd-save-spin 1.1s linear infinite; }
      `}</style>
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms < 15_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)} sec ago`;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
