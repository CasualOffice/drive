import { FolderOpen } from "lucide-react";

export function EmptyState({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        maxWidth: "480px",
        margin: "0 auto",
        padding: "var(--space-6)",
      }}
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
        {title}
      </h1>

      {subtitle && (
        <p
          style={{
            marginTop: "var(--space-2)",
            marginBottom: cta ? "var(--space-6)" : 0,
            fontSize: "var(--text-md)",
            color: "var(--fg-muted)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {subtitle}
        </p>
      )}

      {cta}
    </div>
  );
}
