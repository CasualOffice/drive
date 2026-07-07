/**
 * About section — version, build, license, and the brand mark.
 * Pulls from GET /api/about (build-stamped, no DB read). Dense on-system
 * restyle; git sha rendered mono/tabular. Logic + endpoints unchanged.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

import { getAbout, type About } from "../../api/client.ts";
import { Logo } from "../../components/Logo.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { ErrorBand } from "./controls.tsx";

export function AboutSection() {
  const [about, setAbout] = useState<About | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getAbout().then(setAbout).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  return (
    <>
      <SettingsHeader
        title="About"
        description="The version of Doc-Hub currently running on this instance."
      />

      <SettingsCard title="Build">
        {err ? (
          <ErrorBand>{err}</ErrorBand>
        ) : !about ? (
          <Skeleton />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span aria-hidden style={{ display: "inline-flex", color: "var(--fg-default)", flexShrink: 0 }}>
                <Logo size={44} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--text-lg)",
                    fontWeight: "var(--weight-semibold)",
                    letterSpacing: "var(--tracking-tight)",
                    color: "var(--fg-default)",
                  }}
                >
                  Doc-Hub
                </span>
                <span className="tnum" style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
                  v{about.version}
                  {about.git_sha !== "unknown" && about.git_sha !== "demo" && (
                    <>
                      {" · "}
                      <code className="mono" style={{ fontSize: "var(--mono-xs)" }}>{about.git_sha}</code>
                    </>
                  )}
                </span>
              </div>
            </div>

            <dl
              style={{
                margin: 0,
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "var(--space-2) var(--space-4)",
              }}
            >
              <Cell label="Built at" />
              <Cell value={fmtBuilt(about.built_at)} />
              <Cell label="License" />
              <Cell value={about.license} />
              <Cell label="Storage backend" />
              <Cell value={about.storage_backend} />
              <Cell label="Database" />
              <Cell value={about.db_backend} />
              <Cell label="Repository" />
              <Cell
                value={
                  <a
                    href={about.repository}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "var(--fg-default)",
                      textDecoration: "underline",
                      textDecorationThickness: 1,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {short(about.repository)}
                    <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
                  </a>
                }
              />
            </dl>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Acknowledgements" subtitle="Doc-Hub is open source. Bug reports and contributions welcome.">
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--fg-muted)",
            lineHeight: "var(--leading-md)",
          }}
        >
          Built on Rust, Axum, OpenDAL, sqlx, React, Vite, and Radix Primitives. Typography by Inter
          and JetBrains Mono. Icons by Lucide.
        </p>
      </SettingsCard>
    </>
  );
}

function Cell({ label, value }: { label?: string; value?: React.ReactNode }) {
  if (label) {
    return <dt style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{label}</dt>;
  }
  return (
    <dd
      className="tnum"
      style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--fg-default)", fontWeight: "var(--weight-medium)" }}
    >
      {value}
    </dd>
  );
}

function Skeleton() {
  return <div className="skeleton" style={{ height: 140, borderRadius: "var(--radius-md)" }} />;
}

function short(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function fmtBuilt(iso: string) {
  if (!iso || iso === "unknown") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Honour the user's locale + system timezone — never raw UTC.
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
