/**
 * Share-link recipient page. Spec: docs/ux/05-sharing-surface.md.
 *
 * URL: /s/{token}. The SPA's wildcard router renders this whenever the
 * pathname starts with /s/. No sidebar, no top bar — just file card with
 * one primary action. Password gate shows as a full-screen form.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, Sparkles } from "lucide-react";

import {
  ApiError,
  resolveShare,
  shareDownloadUrl,
  type ResolvedShare,
} from "../api/client.ts";
import { FileThumb, inferKind } from "../components/FileThumb.tsx";
import { Logo, Wordmark } from "../components/Logo.tsx";

type State =
  | { kind: "loading" }
  | { kind: "password" }
  | { kind: "ready"; resolved: ResolvedShare }
  | { kind: "expired" }
  | { kind: "error" }
  | { kind: "missing" };

export function Recipient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [wrongPwd, setWrongPwd] = useState(false);

  const attempt = useCallback(
    async (pwd: string | null) => {
      try {
        const resolved = await resolveShare(token, pwd);
        setState({ kind: "ready", resolved });
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) {
          setState({ kind: "password" });
        } else if (e.status === 410) {
          setState({ kind: "expired" });
        } else if (!e.status || e.status >= 500) {
          // Transient — a network drop or a 5xx, not an existence signal.
          // Offer a retry instead of falsely claiming the link is gone.
          setState({ kind: "error" });
        } else {
          // 404 + other client errors funnel into "missing" so a revoked or
          // nonexistent link stays indistinguishable (no existence leak).
          setState({ kind: "missing" });
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void attempt(null);
  }, [attempt]);

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setWrongPwd(false);
    try {
      const resolved = await resolveShare(token, password);
      setState({ kind: "ready", resolved });
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setWrongPwd(true);
      } else if (e.status === 410) {
        setState({ kind: "expired" });
      } else if (!e.status || e.status >= 500) {
        // Transient during unlock — retry rather than mislabel as missing.
        setState({ kind: "error" });
      } else {
        setState({ kind: "missing" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={page()}>
      <header style={header()}>
        <span style={{ color: "var(--ink)" }}>
          <Logo size={28} />
        </span>
        <Wordmark />
      </header>

      <main style={main()}>
        {state.kind === "loading" && <LoadingState />}
        {state.kind === "password" && (
          <PasswordGate
            password={password}
            wrongPwd={wrongPwd}
            submitting={submitting}
            onChange={setPassword}
            onSubmit={onSubmitPassword}
          />
        )}
        {state.kind === "ready" && <ReadyCard resolved={state.resolved} token={token} />}
        {state.kind === "expired" && (
          <Notice title="This link has expired." body="The file owner can issue a new one." />
        )}
        {state.kind === "error" && (
          <Notice
            title="Something went wrong."
            body="We couldn't reach the server. Check your connection and try again."
            action={<SecondaryButton onClick={() => void attempt(null)}>Try again</SecondaryButton>}
          />
        )}
        {state.kind === "missing" && (
          <Notice title="This link doesn't exist." body="The link may have been revoked, or the URL was mistyped." />
        )}
      </main>

      <footer style={footer()}>Powered by Doc-Hub</footer>
    </div>
  );
}

// ── Sub-states ──────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        color: "var(--muted)",
        fontSize: "var(--text-sm)",
      }}
    >
      <Loader2 size={22} strokeWidth={1.7} style={{ animation: "cd-spin 900ms linear infinite" }} />
      <span>Looking up the file…</span>
      <style>{`@keyframes cd-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ReadyCard({ resolved, token }: { resolved: ResolvedShare; token: string }) {
  const kind = inferKind(resolved.file.name, resolved.file.content_type);
  const typeLabel = labelForKind(kind);

  return (
    <div style={card()}>
      <div
        style={{
          height: 200,
          background: "var(--bg-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "min(260px, 80%)",
            aspectRatio: kind === "img" || kind === "vid" ? "16/10" : "1 / 1.3",
            borderRadius: "var(--radius)",
            overflow: "hidden",
            border: "var(--border-w) solid var(--border)",
            boxShadow: "var(--shadow)",
          }}
        >
          <FileThumb name={resolved.file.name} kind={kind} size="big" />
        </div>
      </div>

      <div style={{ padding: "24px 28px 26px" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-xl)",
            fontWeight: 700,
            letterSpacing: "var(--tracking-tight)",
            color: "var(--ink)",
            wordBreak: "break-word",
          }}
        >
          {resolved.file.name}
        </h2>
        <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          {typeLabel}
          {resolved.file.size > 0 && ` · ${formatBytes(resolved.file.size)}`}
        </div>

        <hr style={{ border: 0, borderTop: "var(--border-w) solid var(--border)", margin: "20px 0" }} />

        <div style={{ display: "flex", gap: 10 }}>
          {(kind === "sheet" || kind === "doc") ? (
            <PrimaryButton onClick={() => window.location.assign(shareDownloadUrl(token, resolved.unlock))}>
              <ExternalLink size={15} strokeWidth={2} />
              Open in Casual {kind === "sheet" ? "Sheets" : "Editor"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => window.location.assign(shareDownloadUrl(token, resolved.unlock))}>
              <Download size={15} strokeWidth={2} />
              Download
            </PrimaryButton>
          )}
          {(kind === "sheet" || kind === "doc") && (
            <SecondaryButton onClick={() => window.location.assign(shareDownloadUrl(token, resolved.unlock))}>
              <Download size={14} strokeWidth={2} />
              Download
            </SecondaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordGate({
  password,
  wrongPwd,
  submitting,
  onChange,
  onSubmit,
}: {
  password: string;
  wrongPwd: boolean;
  submitting: boolean;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} style={{ ...card(), padding: "28px 28px 26px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <span
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius)",
            background: "var(--violet-100)",
            border: "var(--border-w) solid var(--violet-500)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
          }}
        >
          <Sparkles size={22} strokeWidth={1.8} />
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-xl)",
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          This link is password-protected.
        </h2>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)", textAlign: "center" }}>
          Enter the password the owner shared to continue.
        </p>
      </div>

      <input
        type="password"
        autoFocus
        autoComplete="off"
        value={password}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Password"
        disabled={submitting}
        aria-invalid={wrongPwd || undefined}
        style={{
          marginTop: 18,
          width: "100%",
          padding: "12px 14px",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-md)",
          color: "var(--ink)",
          background: "var(--bg-surface)",
          border: `var(--border-w) solid ${wrongPwd ? "var(--danger)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          outline: "none",
        }}
      />
      {wrongPwd && (
        <div role="alert" aria-live="polite" style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--danger)" }}>
          That password didn&apos;t work.
        </div>
      )}

      <button
        type="submit"
        disabled={!password.trim() || submitting}
        className={!password.trim() || submitting ? undefined : "press-sink-lg"}
        style={{
          marginTop: 16,
          width: "100%",
          padding: 12,
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 700,
          color: "var(--on-violet)",
          background: !password.trim() || submitting ? "var(--fg-disabled)" : "var(--violet-500)",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius)",
          cursor: !password.trim() || submitting ? "default" : "pointer",
        }}
      >
        {submitting ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ ...card(), padding: "32px 28px", textAlign: "center" }}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-xl)",
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        {title}
      </h2>
      <p style={{ margin: "10px 0 0", fontSize: "var(--text-sm)", color: "var(--muted)" }}>{body}</p>
      {action && <div style={{ marginTop: 18, display: "flex", justifyContent: "center" }}>{action}</div>}
    </div>
  );
}

// ── primitives ─────────────────────────────────────────────────────────

function page(): React.CSSProperties {
  return {
    minHeight: "100vh",
    width: "100%",
    background: "var(--paper)",
    display: "flex",
    flexDirection: "column",
  };
}

function header(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "22px 30px",
  };
}

function main(): React.CSSProperties {
  return {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 24px 60px",
  };
}

function card(): React.CSSProperties {
  return {
    width: "min(540px, 100%)",
    background: "var(--card)",
    border: "var(--border-w) solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  };
}

function footer(): React.CSSProperties {
  return {
    textAlign: "center",
    padding: "16px 0 26px",
    fontSize: "var(--text-xs)",
    color: "var(--muted-2)",
  };
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-sink-lg"
      style={{
        flex: 1,
        padding: "12px 14px",
        border: "var(--border-w) solid var(--border)",
        background: "var(--violet-500)",
        color: "var(--on-violet)",
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-sink"
      style={{
        padding: "12px 16px",
        border: "var(--border-w) solid var(--border)",
        background: "var(--bg-surface)",
        color: "var(--ink)",
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function labelForKind(k: ReturnType<typeof inferKind>): string {
  switch (k) {
    case "fold":
      return "Folder";
    case "doc":
      return "Document";
    case "sheet":
      return "Spreadsheet";
    case "pdf":
      return "PDF";
    case "img":
      return "Image";
    case "vid":
      return "Video";
    default:
      return "File";
  }
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
