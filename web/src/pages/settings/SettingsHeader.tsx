/**
 * Shared header + card for the Settings sections. Dense on-system styling
 * per docs/design/ui-system.md: 20px page title, 16px card title, hairline
 * borders, --radius-lg cards, 16px padding, muted descriptions (AA). Cards
 * accept an `action` (one control, right-aligned in the head) and a `status`
 * slot (a StatusChip) so a section can show state without colour alone.
 */
import type { ReactNode } from "react";

/** Section page header (one per section pane). */
export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header style={{ marginBottom: "var(--space-5)" }}>
      <h2
        style={{
          margin: 0,
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--fg-default)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "var(--space-1) 0 0",
          fontSize: "var(--text-sm)",
          color: "var(--fg-muted)",
          lineHeight: "var(--leading-sm)",
        }}
      >
        {description}
      </p>
    </header>
  );
}

/** A single card on a Settings section page. */
export function SettingsCard({
  title,
  subtitle,
  action,
  status,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow)",
        padding: "var(--space-4)",
        marginBottom: "var(--space-5)",
      }}
    >
      {(title || action || status) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
            {title && (
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
            )}
            {status}
          </div>
          {action}
        </div>
      )}
      {subtitle && (
        <p
          style={{
            margin: "var(--space-1) 0 0",
            fontSize: "var(--text-sm)",
            color: "var(--fg-muted)",
            lineHeight: "var(--leading-sm)",
          }}
        >
          {subtitle}
        </p>
      )}
      <div style={{ marginTop: "var(--space-4)" }}>{children}</div>
    </section>
  );
}
