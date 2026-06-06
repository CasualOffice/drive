/** Shared header for each real Settings section. */
export function SettingsHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header style={{ marginBottom: 28 }}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 500,
          fontSize: "var(--text-2xl)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
        }}
      >
        {title}
      </h2>
      <p
        style={{
          marginTop: 8,
          fontSize: "var(--text-md)",
          color: "var(--muted)",
          lineHeight: "var(--leading-normal)",
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
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "22px 24px 24px",
        marginBottom: 16,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 500,
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
            marginBottom: 0,
            fontSize: "var(--text-sm)",
            color: "var(--muted)",
            lineHeight: "var(--leading-normal)",
          }}
        >
          {subtitle}
        </p>
      )}
      <div style={{ marginTop: 18 }}>{children}</div>
    </section>
  );
}
