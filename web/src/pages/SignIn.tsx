import { useState } from "react";

import { Logo } from "../components/Logo.tsx";
import { ApiError } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";

export function SignIn() {
  const { signIn } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Username is fixed in v0 (single-tenant admin); the binary's
      // /api/auth/sign-in still expects it in the body.
      await signIn("admin", password);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 429
            ? "Too many attempts. Try again in 10 minutes."
            : "Wrong password."
          : "Couldn't reach the server.";
      setError(msg);
      setShake(true);
      setTimeout(() => setShake(false), 280);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{ background: "var(--bg-canvas)" }}
    >
      <form
        onSubmit={onSubmit}
        className="flex flex-col items-stretch text-center"
        style={{
          width: "360px",
          padding: "var(--space-8) var(--space-6)",
          background: "var(--bg-default)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-md)",
          transform: shake ? "translateX(0)" : undefined,
          animation: shake ? "cd-shake 280ms cubic-bezier(0.32, 0.72, 0, 1)" : undefined,
        }}
      >
        <div style={{ color: "var(--fg-default)", marginBottom: "var(--space-3)" }}>
          <div style={{ display: "inline-block" }}>
            <Logo size={32} />
          </div>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: "var(--text-xl)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--fg-default)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          Casual Drive
        </h1>
        <p
          style={{
            marginTop: "var(--space-2)",
            marginBottom: "var(--space-6)",
            fontSize: "var(--text-md)",
            color: "var(--fg-muted)",
          }}
        >
          Sign in to continue.
        </p>

        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          aria-invalid={error !== null}
          style={{
            width: "100%",
            padding: "var(--space-3) var(--space-3)",
            fontSize: "var(--text-base)",
            fontFamily: "var(--font-sans)",
            color: "var(--fg-default)",
            background: "var(--bg-default)",
            border: `1px solid ${error ? "var(--danger)" : "var(--border-default)"}`,
            borderRadius: "var(--radius-md)",
            outline: "none",
            transition: `border-color var(--dur-fast) var(--ease-out)`,
          }}
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: "var(--space-2)",
              fontSize: "var(--text-xs)",
              color: "var(--danger)",
              textAlign: "left",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          style={{
            width: "100%",
            marginTop: "var(--space-4)",
            padding: "var(--space-3)",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            fontFamily: "var(--font-sans)",
            color: "var(--fg-onAccent)",
            background: busy || !password ? "var(--accent-muted)" : "var(--accent)",
            border: "none",
            borderRadius: "var(--radius-md)",
            cursor: busy || !password ? "default" : "pointer",
            transition: `background var(--dur-fast) var(--ease-out)`,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <style>
        {`
          @keyframes cd-shake {
            0%,100% { transform: translateX(0); }
            25%     { transform: translateX(-6px); }
            75%     { transform: translateX(6px); }
          }
          input:focus-visible {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-muted);
          }
          @media (prefers-reduced-motion: reduce) {
            form { animation: none !important; }
          }
        `}
      </style>
    </div>
  );
}
