import { useEffect, useState } from "react";
import { KeyRound, Sparkles } from "lucide-react";

import { ApiError, DEMO_MODE, oidcLoginUrl, oidcMetadata, type OidcMetadata } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { Logo } from "../components/Logo.tsx";

const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo";

// Phase 3 §12 — query-param error codes the OIDC callback emits when it
// has to bounce the user back here instead of completing the sign-in.
const OIDC_ERROR_COPY: Record<string, string> = {
  idp: "The identity provider rejected the sign-in.",
  expired: "That sign-in attempt expired. Try again.",
  token: "We couldn't verify the identity provider's response.",
  unknown_subject: "Your account isn't linked yet. Ask the admin to invite you.",
};

export function SignIn() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState(DEMO_MODE ? DEMO_USERNAME : "");
  const [password, setPassword] = useState(DEMO_MODE ? DEMO_PASSWORD : "");
  const [capsOn, setCapsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [oidc, setOidc] = useState<OidcMetadata | null>(null);

  useEffect(() => {
    // Surface ?oidc_error=... from the callback redirect, then strip it.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oidc_error");
    if (code) {
      setError(OIDC_ERROR_COPY[code] ?? "Sign-in failed. Try again.");
      params.delete("oidc_error");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
    oidcMetadata()
      .then(setOidc)
      .catch(() => setOidc({ enabled: false, allow_password_auth: true }));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Try again in 10 minutes."
            : "Wrong username or password."
          : "Couldn't reach the server.";
      setError(msg);
      setShake(true);
      setTimeout(() => setShake(false), 300);
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled = busy || !password || !username.trim();
  const passwordEnabled = oidc?.allow_password_auth ?? true;
  const oidcEnabled = oidc?.enabled ?? false;
  const oidcLabel = oidc?.provider_label ?? "your identity provider";

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--paper)",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 360,
          padding: "32px 26px 26px",
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-soft, var(--shadow))",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          animation: shake ? "cd-shake 300ms var(--ease)" : undefined,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ color: "var(--ink)", marginBottom: 4 }}>
            <Logo size={36} />
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-2xl)",
              fontWeight: 500,
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink)",
            }}
          >
            Casual Drive
          </h1>
          <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--muted)" }}>
            {DEMO_MODE && passwordEnabled
              ? "Demo build · sign in with the pre-filled credentials."
              : "Sign in to continue."}
          </p>
        </div>

        {DEMO_MODE && passwordEnabled && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 11,
              padding: "11px 13px",
              background: "var(--accent-muted)",
              border: "1px solid rgba(200, 164, 92, 0.32)",
              borderRadius: 12,
              fontSize: "var(--text-xs)",
              color: "var(--ink-soft)",
              lineHeight: "var(--leading-normal)",
            }}
          >
            <Sparkles size={14} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
            <div>
              Username{" "}
              <code style={kbdStyle()}>{DEMO_USERNAME}</code>
              {" · "}
              Password{" "}
              <code style={kbdStyle()}>{DEMO_PASSWORD}</code>
              <div style={{ marginTop: 4, color: "var(--muted)" }}>
                Any credentials work — this build has no real auth.
              </div>
            </div>
          </div>
        )}

        {oidcEnabled && (
          <a
            href={oidcLoginUrl()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "12px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--paper)",
              background: "var(--ink)",
              border: "none",
              borderRadius: 12,
              textDecoration: "none",
              cursor: "pointer",
              transition: "background 200ms var(--ease), transform 200ms",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={(e) => (e.currentTarget.style.transform = "")}
          >
            <KeyRound size={15} strokeWidth={1.8} />
            Sign in with {oidcLabel}
          </a>
        )}

        {oidcEnabled && passwordEnabled && (
          <div
            aria-hidden="true"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: "var(--text-xs)",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            or
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>
        )}

        {passwordEnabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Input
            type="text"
            name="username"
            autoComplete="username"
            placeholder="Username"
            autoFocus
            disabled={busy}
            invalid={error !== null}
            value={username}
            onChange={(v) => setUsername(v)}
          />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            disabled={busy}
            invalid={error !== null}
            value={password}
            onChange={(v) => setPassword(v)}
            onCapsLockChange={setCapsOn}
          />
          {capsOn && (
            <div
              role="status"
              style={{
                marginTop: 2,
                fontSize: "var(--text-xs)",
                color: "var(--warning)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 10 }}>⇪</span>
              Caps Lock is on.
            </div>
          )}
        </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              marginTop: -8,
              fontSize: "var(--text-xs)",
              color: "var(--danger)",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        {passwordEnabled && (
          <button
            type="submit"
            disabled={submitDisabled}
            style={{
              width: "100%",
              padding: "12px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              color: "var(--paper)",
              background: submitDisabled ? "rgba(15, 23, 42,.35)" : "var(--ink)",
              border: "none",
              borderRadius: 12,
              cursor: submitDisabled ? "default" : "pointer",
              transition: "background 200ms var(--ease), transform 200ms",
            }}
            onMouseOver={(e) => {
              if (!submitDisabled) e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseOut={(e) => (e.currentTarget.style.transform = "")}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        )}

        {!passwordEnabled && !oidcEnabled && (
          <div
            role="alert"
            style={{
              padding: "11px 13px",
              background: "var(--warning-muted, rgba(200,164,92,.12))",
              border: "1px solid rgba(200, 164, 92, 0.32)",
              borderRadius: 12,
              fontSize: "var(--text-xs)",
              color: "var(--ink-soft)",
            }}
          >
            Sign-in is disabled. Ask the operator to set
            {" "}<code style={kbdStyle()}>DRIVE_ALLOW_PASSWORD_AUTH=true</code>{" "}
            or configure an OIDC provider.
          </div>
        )}
      </form>

      <style>
        {`
          @keyframes cd-shake {
            0%,100% { transform: translateX(0); }
            25%     { transform: translateX(-6px); }
            75%     { transform: translateX(6px); }
          }
          @media (prefers-reduced-motion: reduce) {
            form { animation: none !important; }
          }
        `}
      </style>
    </div>
  );
}

function kbdStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 5,
    padding: "1px 6px",
    fontSize: 11,
    color: "var(--ink)",
  };
}

function Input({
  type,
  name,
  autoComplete,
  placeholder,
  autoFocus,
  disabled,
  invalid,
  value,
  onChange,
  onCapsLockChange,
}: {
  type: "text" | "password";
  name: string;
  autoComplete: string;
  placeholder: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  value: string;
  onChange: (v: string) => void;
  /** Fires when the keyboard's Caps Lock modifier flips while this input
   * has focus. Used by the sign-in form to surface a one-line warning
   * under the password field — silent for other inputs. */
  onCapsLockChange?: (on: boolean) => void;
}) {
  return (
    <input
      type={type}
      name={name}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => onCapsLockChange?.(e.getModifierState("CapsLock"))}
      onKeyUp={(e) => onCapsLockChange?.(e.getModifierState("CapsLock"))}
      style={{
        width: "100%",
        padding: "12px 14px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-base)",
        color: "var(--ink)",
        background: "var(--paper)",
        border: `1px solid ${invalid ? "var(--danger)" : "var(--line)"}`,
        borderRadius: 12,
        outline: "none",
        transition: "border-color 150ms, box-shadow 150ms",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = invalid ? "var(--danger)" : "var(--line-strong)";
        e.currentTarget.style.boxShadow = "0 0 0 4px rgba(15, 23, 42,.04)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? "var(--danger)" : "var(--line)";
        e.currentTarget.style.boxShadow = "";
        onCapsLockChange?.(false);
      }}
    />
  );
}
