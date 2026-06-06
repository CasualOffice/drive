import { FolderOpen, Upload } from "lucide-react";

/**
 * Empty state — surface §7, flow §1 (first-run).
 *
 * Centred column, ~480px max-width, vertical flow:
 *   glyph → title (text-xl semibold) → subtitle (text-md muted) → primary button + chord
 */
export function EmptyState() {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ maxWidth: "480px", padding: "var(--space-6)" }}
    >
      <div style={{ marginBottom: "var(--space-6)", color: "var(--fg-subtle)" }}>
        <FolderOpen size={56} strokeWidth={1.5} />
      </div>

      <h1
        style={{
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--leading-tight)",
          color: "var(--fg-default)",
          letterSpacing: "var(--tracking-tight)",
          margin: 0,
        }}
      >
        Your Drive is empty.
      </h1>

      <p
        style={{
          marginTop: "var(--space-2)",
          marginBottom: "var(--space-6)",
          fontSize: "var(--text-md)",
          color: "var(--fg-muted)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        Drop files anywhere, or use Upload.
      </p>

      <button
        type="button"
        className="inline-flex items-center gap-2 transition-all"
        style={{
          background: "var(--accent)",
          color: "var(--fg-onAccent)",
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
          padding: "var(--space-2) var(--space-4)",
          borderRadius: "var(--radius-md)",
          border: "none",
          boxShadow: "var(--shadow-sm)",
          cursor: "pointer",
          transitionDuration: "var(--dur-fast)",
          transitionTimingFunction: "var(--ease-out)",
        }}
        onMouseOver={(e) => (e.currentTarget.style.background = "var(--accent-hover)")}
        onMouseOut={(e) => (e.currentTarget.style.background = "var(--accent)")}
        onFocus={(e) => (e.currentTarget.style.boxShadow = "var(--focus-ring)")}
        onBlur={(e) => (e.currentTarget.style.boxShadow = "var(--shadow-sm)")}
      >
        <Upload size={16} strokeWidth={2} />
        <span>Upload</span>
        <span
          className="ml-2 tabular-nums"
          style={{
            background: "rgba(255,255,255,0.16)",
            color: "var(--fg-onAccent)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-mono)",
            padding: "2px 6px",
            borderRadius: "var(--radius-xs)",
            opacity: 0.85,
          }}
        >
          U
        </span>
      </button>
    </div>
  );
}
