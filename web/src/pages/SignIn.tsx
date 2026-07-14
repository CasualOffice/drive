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
      // Honor a return path stashed by an invite/share page that bounced an
      // anonymous visitor here — send them back to finish what they started.
      try {
        const returnTo = sessionStorage.getItem("returnTo");
        if (returnTo && returnTo !== "/") {
          sessionStorage.removeItem("returnTo");
          window.history.pushState({}, "", returnTo);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      } catch {
        /* storage disabled — land on the app root, still signed in */
      }
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
        position: "relative",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        // Flat — the fixed dotted <AmbientGround/> shows through; the card
        // carries all the depth via its hard border + offset shadow.
        background: "transparent",
        overflow: "hidden",
      }}
    >
      <form
        onSubmit={onSubmit}
        className="signin-card"
        style={{
          position: "relative",
          zIndex: 1,
          width: 408,
          maxWidth: "100%",
          padding: "36px 32px 30px",
          background: "var(--bg-surface)",
          border: "var(--border-w) solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          borderRadius: "var(--radius)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          animation: shake ? "cd-shake 300ms var(--ease)" : undefined,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div
            style={{ color: "var(--violet-500)", ["--mark-fg" as string]: "var(--bg-surface)" }}
            aria-hidden="true"
          >
            <Logo size={48} />
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-display-lg)",
              lineHeight: "var(--leading-display-lg)",
              fontWeight: 700,
              letterSpacing: "var(--tracking-display-lg)",
              color: "var(--ink)",
              textAlign: "center",
            }}
          >
            Doc-Hub
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-md)",
              lineHeight: "var(--leading-normal)",
              color: "var(--fg-muted)",
              textAlign: "center",
              maxWidth: 300,
            }}
          >
            {DEMO_MODE && passwordEnabled
              ? "A reading room for permanent records. Sign in with the pre-filled credentials."
              : "Sign in to your registry to continue."}
          </p>
        </div>

        {DEMO_MODE && passwordEnabled && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 11,
              padding: "12px 14px",
              background: "var(--violet-100)",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
              lineHeight: "var(--leading-normal)",
            }}
          >
            <Sparkles size={14} strokeWidth={2.4} style={{ color: "var(--violet-500)", flexShrink: 0, marginTop: 2 }} />
            <div>
              Username{" "}
              <code style={kbdStyle()}>{DEMO_USERNAME}</code>
              {" · "}
              Password{" "}
              <code style={kbdStyle()}>{DEMO_PASSWORD}</code>
              <div style={{ marginTop: 4, color: "var(--fg-muted)" }}>
                Any credentials work — this build has no real auth.
              </div>
            </div>
          </div>
        )}

        {oidcEnabled && (
          <a
            href={oidcLoginUrl()}
            className="signin-oidc"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              padding: "12px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              fontWeight: 650,
              color: "var(--ink)",
              background: "var(--bg-surface)",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow)",
              textDecoration: "none",
              cursor: "pointer",
              transition: "transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "var(--lift)";
              e.currentTarget.style.boxShadow = "var(--shadow-lg)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "var(--shadow)";
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = "var(--lift-press)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "var(--lift)";
              e.currentTarget.style.boxShadow = "var(--shadow-lg)";
            }}
          >
            <KeyRound size={15} strokeWidth={2.4} />
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
              fontSize: "var(--text-2xs)",
              color: "var(--fg-subtle)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-wider)",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "var(--border-hair)" }} />
            or
            <span style={{ flex: 1, height: 1, background: "var(--border-hair)" }} />
          </div>
        )}

        {passwordEnabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input
            type="text"
            name="username"
            autoComplete="username"
            placeholder="Username"
            autoFocus
            disabled={busy}
            invalid={error !== null}
            value={username}
            onChange={(v) => {
              setUsername(v);
              if (error) setError(null);
            }}
          />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Password"
            disabled={busy}
            invalid={error !== null}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            onCapsLockChange={setCapsOn}
          />
          {capsOn && (
            <div
              role="status"
              style={{
                marginTop: 2,
                fontSize: "var(--text-xs)",
                color: "var(--status-attention-700)",
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
              color: "var(--status-danger-700)",
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
            className="signin-submit"
            data-disabled={submitDisabled || undefined}
            style={{
              width: "100%",
              padding: "13px",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              fontWeight: 700,
              letterSpacing: "var(--tracking-tight)",
              color: submitDisabled ? "var(--fg-disabled)" : "var(--on-violet)",
              background: submitDisabled ? "var(--bg-sunken)" : "var(--violet-500)",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: submitDisabled ? "default" : "pointer",
              boxShadow: submitDisabled ? "none" : "var(--shadow)",
              transition:
                "background var(--dur) var(--ease), transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
            }}
            onMouseOver={(e) => {
              if (submitDisabled) return;
              e.currentTarget.style.transform = "var(--lift)";
              e.currentTarget.style.background = "var(--violet-600)";
              e.currentTarget.style.boxShadow = "var(--shadow-lg)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.background = submitDisabled
                ? "var(--bg-sunken)"
                : "var(--violet-500)";
              e.currentTarget.style.boxShadow = submitDisabled ? "none" : "var(--shadow)";
            }}
            onMouseDown={(e) => {
              if (submitDisabled) return;
              // The Press — sink into the offset shadow.
              e.currentTarget.style.transform = "var(--lift-press)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
            }}
            onMouseUp={(e) => {
              if (submitDisabled) return;
              e.currentTarget.style.transform = "var(--lift)";
              e.currentTarget.style.boxShadow = "var(--shadow-lg)";
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        )}

        {!passwordEnabled && !oidcEnabled && (
          <div
            role="alert"
            style={{
              padding: "11px 13px",
              background: "var(--violet-100)",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-xs)",
              color: "var(--ink)",
            }}
          >
            Sign-in is disabled. Ask the operator to set
            {" "}<code style={kbdStyle()}>DOCHUB_ALLOW_PASSWORD_AUTH=true</code>{" "}
            or configure an OIDC provider.
          </div>
        )}

        {/* Ambient trust footer — specific claim + mono, the peak-anxiety cue. */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            marginTop: 2,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--mono-xs)",
            color: "var(--fg-subtle)",
            letterSpacing: "0.01em",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 2,
              background: "var(--ok)",
              border: "1.5px solid var(--border)",
              flexShrink: 0,
            }}
          />
          AES-256 · tamper-evident · hash-chained
        </div>
      </form>

      <style>
        {`
          @keyframes cd-shake {
            0%,100% { transform: translateX(0); }
            25%     { transform: translateX(-6px); }
            75%     { transform: translateX(6px); }
          }
          @media (prefers-reduced-motion: reduce) {
            .signin-card { animation: none !important; }
          }
        `}
      </style>
    </div>
  );
}

function kbdStyle(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    background: "var(--bg-sunken)",
    border: "var(--border-w) solid var(--border)",
    borderRadius: "var(--radius-xs)",
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
        fontSize: "var(--text-md)",
        fontWeight: "var(--weight-medium)",
        color: "var(--ink)",
        background: "var(--bg-surface)",
        border: `var(--border-w) solid ${invalid ? "var(--danger)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        outline: "none",
        transition: "border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
      }}
      onFocus={(e) => {
        // Inset focus → violet border + violet hard offset shadow.
        e.currentTarget.style.borderColor = invalid ? "var(--danger)" : "var(--violet-500)";
        e.currentTarget.style.boxShadow = invalid
          ? "2px 2px 0 0 var(--danger)"
          : "2px 2px 0 0 var(--violet-500)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? "var(--danger)" : "var(--border)";
        e.currentTarget.style.boxShadow = "";
        onCapsLockChange?.(false);
      }}
    />
  );
}
