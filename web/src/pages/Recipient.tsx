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
        } else {
          // 404 + everything else funnels into "missing" to avoid leaking
          // existence of a share link.
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
        {state.kind === "missing" && (
          <Notice title="This link doesn't exist." body="The link may have been revoked, or the URL was mistyped." />
        )}
      </main>

      <footer style={footer()}>Powered by Casual Drive</footer>
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
          background: "#E7E4DC",
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
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 8px 28px rgba(26,26,30,.15)",
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
            fontWeight: 500,
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

        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "20px 0" }} />

        <div style={{ display: "flex", gap: 10 }}>
          {(kind === "sheet" || kind === "doc") ? (
            <PrimaryButton onClick={() => window.location.assign(shareDownloadUrl(token))}>
              <ExternalLink size={15} strokeWidth={2} />
              Open in Casual {kind === "sheet" ? "Sheets" : "Editor"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => window.location.assign(shareDownloadUrl(token))}>
              <Download size={15} strokeWidth={2} />
              Download
            </PrimaryButton>
          )}
          {(kind === "sheet" || kind === "doc") && (
            <SecondaryButton onClick={() => window.location.assign(shareDownloadUrl(token))}>
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
            borderRadius: 14,
            background: "var(--accent-muted)",
            border: "1px solid rgba(200,164,92,.32)",
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
            fontWeight: 500,
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
          background: "var(--paper)",
          border: `1px solid ${wrongPwd ? "var(--danger)" : "var(--line)"}`,
          borderRadius: 12,
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
        style={{
          marginTop: 16,
          width: "100%",
          padding: 12,
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--paper)",
          background: !password.trim() || submitting ? "rgba(26,26,30,.35)" : "var(--ink)",
          border: "none",
          borderRadius: 12,
          cursor: !password.trim() || submitting ? "default" : "pointer",
        }}
      >
        {submitting ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ ...card(), padding: "32px 28px", textAlign: "center" }}>
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-xl)",
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        {title}
      </h2>
      <p style={{ margin: "10px 0 0", fontSize: "var(--text-sm)", color: "var(--muted)" }}>{body}</p>
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
    border: "1px solid var(--line)",
    borderRadius: 20,
    boxShadow: "var(--shadow)",
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
      style={{
        flex: 1,
        padding: "12px 14px",
        border: "none",
        background: "var(--ink)",
        color: "var(--paper)",
        borderRadius: 12,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
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
      style={{
        padding: "12px 16px",
        border: "1px solid var(--line)",
        background: "var(--paper)",
        color: "var(--ink)",
        borderRadius: 12,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
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
