import { Sparkles } from "lucide-react";

/**
 * "Coming in v0.2" empty state. First-class component — every Phase-2/3 surface
 * gets a polished ComingSoon page rather than a 404 or blank.
 */
export function ComingSoon({
  title,
  description,
  shipping = "v0.2",
  bullets,
}: {
  title: string;
  description: string;
  shipping?: string;
  bullets?: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "80px 40px",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "var(--radius-xl)",
          background: "var(--violet-100)",
          border: "var(--border-w) solid var(--border)",
          boxShadow: "var(--shadow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 22,
          color: "var(--violet-500)",
        }}
      >
        <Sparkles size={42} strokeWidth={1.4} />
      </div>

      <div
        className="caps-label"
        style={{
          color: "var(--violet-500)",
          marginBottom: 8,
        }}
      >
        Coming in {shipping}
      </div>

      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          fontSize: "var(--text-2xl)",
          color: "var(--ink)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        {title}
      </h2>

      <p
        style={{
          marginTop: 10,
          fontSize: "var(--text-md)",
          color: "var(--muted)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        {description}
      </p>

      {bullets && bullets.length > 0 && (
        <ul
          style={{
            marginTop: 26,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            textAlign: "left",
            maxWidth: 460,
            width: "100%",
          }}
        >
          {bullets.map((b) => (
            <li
              key={b}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: "var(--text-sm)",
                color: "var(--ink-soft)",
                padding: "10px 14px",
                background: "var(--bg-surface)",
                border: "var(--border-w) solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <span
                style={{
                  color: "var(--violet-500)",
                  marginTop: 2,
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                →
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
