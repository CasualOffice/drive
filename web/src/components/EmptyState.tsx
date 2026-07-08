import type { ReactNode } from "react";

import { RegistryMotif, type MotifOverlay } from "./ds/RegistryMotif.tsx";

/**
 * EmptyState — the shared registry-motif empty block (ui-empty-states §1).
 * Compact by design (max-width 420px, ≤32px top padding), never a
 * full-viewport hero. Default illustration is the document-stack motif.
 *
 * Backward-compatible: legacy call sites pass `{title, subtitle, cta, icon}`
 * and still work — `subtitle→body`, `cta→primary`, `icon` replaces the
 * default motif.
 */
export function EmptyState({
  title,
  // new anatomy
  body,
  illustration,
  primary,
  secondary,
  hint,
  role = "status",
  tone = "calm",
  // legacy props (mapped)
  subtitle,
  cta,
  icon,
}: {
  title: string;
  body?: string;
  illustration?: MotifOverlay;
  primary?: ReactNode;
  secondary?: ReactNode;
  hint?: ReactNode;
  role?: "status" | "alert";
  tone?: "calm" | "alarm";
  subtitle?: string;
  cta?: ReactNode;
  icon?: ReactNode;
}) {
  const bodyText = body ?? subtitle;
  const primaryNode = primary ?? cta;

  return (
    <div
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        maxWidth: 420,
        margin: "0 auto",
        gap: "var(--space-4)",
        paddingTop: "var(--space-8)",
        animation: "cd-empty-in var(--dur-base) var(--ease-out)",
      }}
    >
      <div style={{ display: "flex" }}>
        {icon ?? (
          <RegistryMotif
            overlay={illustration}
            tone={tone === "alarm" ? "danger" : "subtle"}
          />
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-bold)",
            fontSize: "var(--text-lg)",
            lineHeight: "var(--leading-lg)",
            color: "var(--fg-default)",
          }}
        >
          {title}
        </h3>
        {bodyText && (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-sm)",
              lineHeight: "var(--leading-sm)",
              fontWeight: "var(--weight-medium)",
              color: "var(--fg-muted)",
            }}
          >
            {bodyText}
          </p>
        )}
      </div>

      {(primaryNode || secondary) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {primaryNode}
          {secondary}
        </div>
      )}

      {hint && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "center",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-sm)",
            color: "var(--fg-subtle)",
          }}
        >
          {hint}
        </div>
      )}

      <style>{`
        @keyframes cd-empty-in { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}

/**
 * EmptyStateButton — the single violet primary an empty block is allowed.
 * A compact 28px on-system button; ghost variant for the secondary.
 */
export function EmptyStateButton({
  children,
  onClick,
  icon,
  variant = "primary",
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={primary ? "press-sink-lg" : "press-sink"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 12px",
        borderRadius: "var(--radius)",
        border: "var(--border-w) solid var(--border)",
        background: primary ? "var(--violet-500)" : "var(--bg-surface)",
        color: primary ? "var(--on-violet)" : "var(--ink)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-md)",
        fontWeight: "var(--weight-medium)",
        cursor: "pointer",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = primary
          ? "var(--violet-600)"
          : "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = primary
          ? "var(--violet-500)"
          : "var(--bg-surface)";
      }}
    >
      {icon}
      {children}
    </button>
  );
}
