/**
 * Shared dense form controls for the Settings + Admin surfaces.
 * Tokens + density per docs/design/ui-system.md §7.9 (buttons) / §7.10
 * (inputs): 28px buttons, 30px inputs, --radius-sm, hairline-first borders,
 * amber the sole chroma (primary), status text on the AA-safe -700 steps,
 * focus-visible amber ring, one Lucide weight (1.5). Kept deliberately small
 * so section files stay declarative and consistent.
 */
import { forwardRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

export const STROKE = 1.5;

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "default";

const HEIGHT: Record<Size, number> = { sm: 24, default: 28 };

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "secondary", size = "default", style, disabled, ...rest }, ref) {
  const [hover, setHover] = useState(false);
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-1)",
    height: HEIGHT[size],
    padding: `0 ${size === "sm" ? 8 : 12}px`,
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-md)",
    fontWeight: "var(--weight-medium)",
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    transition: "background var(--dur-instant) var(--ease), border-color var(--dur-instant) var(--ease)",
  };
  const tone: Record<Variant, React.CSSProperties> = {
    primary: {
      border: "1px solid transparent",
      background: disabled ? "var(--fg-disabled)" : hover ? "var(--accent-hover)" : "var(--accent)",
      color: "var(--accent-fg)",
    },
    secondary: {
      border: "1px solid var(--border-strong)",
      background: hover ? "var(--bg-hover)" : "var(--bg-raised)",
      color: "var(--fg-default)",
    },
    danger: {
      border: "1px solid var(--status-danger-700)",
      background: hover ? "rgba(163,44,34,0.08)" : "transparent",
      color: "var(--status-danger-700)",
    },
    ghost: {
      border: "1px solid transparent",
      background: hover ? "var(--bg-hover)" : "transparent",
      color: "var(--fg-muted)",
    },
  };
  return (
    <button
      ref={ref}
      disabled={disabled}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...tone[variant], opacity: disabled && variant !== "primary" ? 0.5 : 1, ...style }}
      {...rest}
    />
  );
});

/** Dense labelled text field. Spreads `react-hook-form` register props. */
export const Field = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }
>(function Field({ label, error, hint, id, style, ...input }, ref) {
  const fieldId = id ?? `fld-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const describedBy = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      <label
        htmlFor={fieldId}
        style={{
          display: "block",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          color: "var(--fg-muted)",
          marginBottom: "var(--space-1)",
        }}
      >
        {label}
      </label>
      <input
        ref={ref}
        {...input}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        style={{
          display: "block",
          width: "100%",
          height: 30,
          padding: "0 var(--space-3)",
          border: `1px solid ${error ? "var(--status-danger-700)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-sunken)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-md)",
          color: "var(--fg-default)",
          outline: "none",
          transition: "border-color var(--dur-instant) var(--ease), box-shadow var(--dur-instant) var(--ease)",
          ...style,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--border-focus)";
          e.currentTarget.style.boxShadow = "var(--shadow-focus)";
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--status-danger-700)" : "var(--border-strong)";
          e.currentTarget.style.boxShadow = "none";
          input.onBlur?.(e);
        }}
      />
      {error ? (
        <div
          id={`${fieldId}-err`}
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-1)",
            marginTop: "var(--space-1)",
            fontSize: "var(--text-xs)",
            color: "var(--status-danger-700)",
          }}
        >
          <ShieldAlert size={12} strokeWidth={STROKE} aria-hidden />
          {error}
        </div>
      ) : hint ? (
        <div
          id={`${fieldId}-hint`}
          style={{ marginTop: "var(--space-1)", fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
});

/** Inline aria-live error band shown above the offending card body. */
export function ErrorBand({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        background: "rgba(163,44,34,0.06)",
        border: "1px solid var(--status-danger-700)",
        borderRadius: "var(--radius-md)",
        fontSize: "var(--text-sm)",
        color: "var(--fg-default)",
      }}
    >
      <span aria-hidden style={{ color: "var(--status-danger-700)", flexShrink: 0, marginTop: 1 }}>
        <ShieldAlert size={14} strokeWidth={STROKE} />
      </span>
      <span>{children}</span>
    </div>
  );
}
