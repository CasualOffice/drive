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
        position: "relative",
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        // Transparent so the fixed <AmbientGround/> Aura glows through; a
        // gentle centre-lit vignette adds depth and pulls the eye to the card
        // (kills the barren flat-void first impression).
        background:
          "radial-gradient(120% 90% at 50% 32%, transparent 0%, var(--signin-vignette) 100%)",
        overflow: "hidden",
      }}
    >
      {/* The single amber light — a soft focal bloom behind the card. The
          brand's "one lamp that means verified", rendered as atmosphere. */}
      <div aria-hidden="true" className="signin-bloom" />

      <form
        onSubmit={onSubmit}
        className="signin-card"
        style={{
          position: "relative",
          zIndex: 1,
          width: 408,
          maxWidth: "100%",
          padding: "36px 32px 30px",
          borderRadius: "var(--radius-xl)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          animation: shake ? "cd-shake 300ms var(--ease)" : undefined,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <div
            className="signin-mark"
            style={{ color: "var(--accent)" }}
            aria-hidden="true"
          >
            <Logo size={44} />
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-display-lg)",
              lineHeight: "var(--leading-display-lg)",
              fontWeight: 600,
              letterSpacing: "var(--tracking-display-lg)",
              color: "var(--fg-default)",
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
              background: "var(--amber-glow-2)",
              border: "1px solid var(--amber-glow-1)",
              borderRadius: "var(--radius-lg)",
              fontSize: "var(--text-sm)",
              color: "var(--fg-default)",
              lineHeight: "var(--leading-normal)",
            }}
          >
            <Sparkles size={14} strokeWidth={2} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
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
              fontWeight: 500,
              color: "var(--fg-default)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              cursor: "pointer",
              transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.background = "var(--bg-active)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.background = "var(--bg-hover)";
            }}
          >
            <KeyRound size={15} strokeWidth={2} />
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
              fontWeight: 600,
              letterSpacing: "var(--tracking-tight)",
              color: submitDisabled ? "var(--fg-disabled)" : "var(--accent-fg)",
              background: submitDisabled ? "var(--bg-sunken)" : "var(--accent)",
              border: "1px solid transparent",
              borderRadius: "var(--radius-sm)",
              cursor: submitDisabled ? "default" : "pointer",
              boxShadow: submitDisabled
                ? "none"
                : "0 6px 20px rgba(242, 163, 36, 0.35), var(--edge-hi)",
              transition:
                "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
            }}
            onMouseOver={(e) => {
              if (submitDisabled) return;
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.background = "var(--accent-hover)";
              e.currentTarget.style.boxShadow =
                "0 8px 26px rgba(242, 163, 36, 0.45), var(--edge-hi)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.background = submitDisabled
                ? "var(--bg-sunken)"
                : "var(--accent)";
              e.currentTarget.style.boxShadow = submitDisabled
                ? "none"
                : "0 6px 20px rgba(242, 163, 36, 0.35), var(--edge-hi)";
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
              background: "var(--amber-glow-2)",
              border: "1px solid var(--amber-glow-1)",
              borderRadius: "var(--radius-lg)",
              fontSize: "var(--text-xs)",
              color: "var(--fg-default)",
            }}
          >
            Sign-in is disabled. Ask the operator to set
            {" "}<code style={kbdStyle()}>DRIVE_ALLOW_PASSWORD_AUTH=true</code>{" "}
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
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--status-verified)",
              boxShadow: "0 0 8px var(--status-verified)",
              flexShrink: 0,
            }}
          />
          AES-256 · tamper-evident · hash-chained
        </div>
      </form>

      <style>
        {`
          :root { --signin-vignette: rgba(22, 22, 26, 0.05); }
          :root[data-theme="dark"], .dark { --signin-vignette: rgba(0, 0, 0, 0.55); }
          @media (prefers-color-scheme: dark) {
            :root:not([data-theme]), :root[data-theme="system"] {
              --signin-vignette: rgba(0, 0, 0, 0.55);
            }
          }

          /* The glass sign-in card — real depth: rim-light + deep float
             shadow over the blurred Aura. */
          .signin-card {
            background: var(--mat-thick);
            backdrop-filter: blur(var(--blur-overlay)) saturate(var(--saturate));
            -webkit-backdrop-filter: blur(var(--blur-overlay)) saturate(var(--saturate));
            border: var(--hairline-glass);
            box-shadow: var(--edge-hi), var(--shadow-overlay);
          }
          @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
            .signin-card { background: var(--glass-solid); }
          }
          @media (prefers-reduced-transparency: reduce) {
            .signin-card {
              background: var(--glass-solid);
              backdrop-filter: none;
              -webkit-backdrop-filter: none;
            }
          }

          /* The amber focal bloom behind the card. */
          .signin-bloom {
            position: absolute;
            top: 30%;
            left: 50%;
            width: 640px;
            height: 640px;
            transform: translate(-50%, -50%);
            border-radius: 50%;
            pointer-events: none;
            z-index: 0;
            background: radial-gradient(
              circle at center,
              var(--amber-glow-1) 0%,
              var(--amber-glow-2) 30%,
              transparent 66%
            );
            filter: blur(28px);
            opacity: 0.9;
            animation: cd-bloom-breathe 7s var(--ease-inout) infinite alternate;
          }

          .signin-mark svg {
            filter: drop-shadow(0 4px 14px var(--amber-glow-2));
          }

          @keyframes cd-bloom-breathe {
            from { opacity: 0.72; transform: translate(-50%, -50%) scale(0.98); }
            to   { opacity: 1;    transform: translate(-50%, -50%) scale(1.04); }
          }

          @keyframes cd-shake {
            0%,100% { transform: translateX(0); }
            25%     { transform: translateX(-6px); }
            75%     { transform: translateX(6px); }
          }
          @media (prefers-reduced-motion: reduce) {
            .signin-card { animation: none !important; }
            .signin-bloom { animation: none; }
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
    border: "1px solid var(--border-hair)",
    borderRadius: "var(--radius-xs)",
    padding: "1px 6px",
    fontSize: 11,
    color: "var(--fg-default)",
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
        color: "var(--fg-default)",
        background: "var(--bg-sunken)",
        border: `1px solid ${invalid ? "var(--status-danger)" : "var(--border-hair)"}`,
        borderRadius: "var(--radius-sm)",
        outline: "none",
        transition: "border-color 150ms var(--ease-out), box-shadow 150ms var(--ease-out)",
      }}
      onFocus={(e) => {
        // Retuned amber focus ring (§2.2): 2px surface gap + amber glow.
        e.currentTarget.style.borderColor = invalid ? "var(--status-danger)" : "var(--accent)";
        e.currentTarget.style.boxShadow = invalid
          ? "0 0 0 2px var(--bg-surface), 0 0 0 4px var(--status-danger)"
          : "0 0 0 2px var(--bg-surface), 0 0 0 4px var(--amber-glow-1)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? "var(--status-danger)" : "var(--border-hair)";
        e.currentTarget.style.boxShadow = "";
        onCapsLockChange?.(false);
      }}
    />
  );
}
