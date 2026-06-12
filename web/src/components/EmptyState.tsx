import { FolderOpen } from "lucide-react";

export function EmptyState({
  title,
  subtitle,
  cta,
  icon = <FolderOpen size={42} strokeWidth={1.4} />,
}: {
  title: string;
  subtitle?: string;
  cta?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "70px 0",
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          background: "rgba(15, 23, 42,.035)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
          color: "var(--muted-2)",
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "var(--text-lg)",
          color: "var(--ink)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          style={{
            marginTop: 6,
            marginBottom: cta ? 18 : 0,
            fontSize: "var(--text-base)",
            color: "var(--muted)",
          }}
        >
          {subtitle}
        </p>
      )}
      {cta}
    </div>
  );
}
