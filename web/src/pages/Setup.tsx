/**
 * First-run admin-setup wizard. Spec: docs/ux/04-setup-wizard.md.
 *
 * Triggered only when GET /api/setup/status returns {needs_setup: true},
 * i.e. zero users in the DB. Once the wizard's POST /api/setup/admin
 * succeeds, the backend mints a session in the same response — we route
 * straight to the shell without going through the sign-in card.
 */
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { ApiError, setupAdmin } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { Logo } from "../components/Logo.tsx";

type Step = "welcome" | "create" | "ready";

export function Setup() {
  const { refresh } = useAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [createdUsername, setCreatedUsername] = useState("");

  async function onCreated(username: string) {
    setCreatedUsername(username);
    setStep("ready");
    // Brief beat so the user sees the success acknowledgement before the
    // shell stage-swap kicks in.
    setTimeout(() => {
      void refresh();
    }, 700);
  }

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--paper)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 460,
          maxWidth: "100%",
          background: "var(--card)",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-lg)",
          padding: "34px 30px 28px",
          animation: "cd-fade-in 280ms var(--ease)",
        }}
      >
        <Header />
        <StepIndicator step={step} />

        {step === "welcome" && <WelcomeStep onNext={() => setStep("create")} />}
        {step === "create" && <CreateStep onCreated={onCreated} />}
        {step === "ready" && <ReadyStep username={createdUsername} />}
      </div>
      <style>{`
        @keyframes cd-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function Header() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ color: "var(--ink)" }}>
        <Logo size={48} />
      </div>
      <h1
        style={{
          margin: "4px 0 0",
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
        }}
      >
        Welcome to Doc-Hub
      </h1>
      <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--muted)", textAlign: "center" }}>
        Let&apos;s set up your administrator account.
      </p>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const order: Step[] = ["welcome", "create", "ready"];
  const i = order.indexOf(step);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "22px 0 4px" }}>
      {order.map((s, idx) => {
        const active = idx === i;
        const done = idx < i;
        return (
          <span
            key={s}
            style={{
              width: active ? 22 : 8,
              height: 8,
              borderRadius: "var(--radius-sm)",
              background: active ? "var(--ink)" : done ? "var(--accent)" : "var(--line-strong)",
              transition: "width 260ms var(--ease), background 260ms",
            }}
          />
        );
      })}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <p
        style={{
          margin: 0,
          fontSize: "var(--text-md)",
          color: "var(--ink-soft)",
          lineHeight: "var(--leading-normal)",
        }}
      >
        Doc-Hub is a self-hosted, encrypted, tamper-evident document hub — part of the Casual Office
        suite. Every version is hash-chained and append-only. This is a one-time setup — you&apos;ll
        create the first administrator account and then you&apos;re in.
      </p>
      <PrimaryButton onClick={onNext}>Get started</PrimaryButton>
    </div>
  );
}

function CreateStep({ onCreated }: { onCreated: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const usernameError = touched(username) && username.trim().length < 3 ? "At least 3 characters." : null;
  const passwordError = touched(password) && password.length < 12 ? "At least 12 characters." : null;
  const confirmError = touched(confirm) && confirm !== password ? "Doesn't match." : null;
  const canSubmit =
    !busy &&
    username.trim().length >= 3 &&
    password.length >= 12 &&
    confirm === password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setServerError(null);
    try {
      await setupAdmin(username.trim(), password);
      onCreated(username.trim());
    } catch (err) {
      const e = err as ApiError;
      const body = e.body as { error?: string } | null;
      setServerError(body?.error ?? e.message ?? "Couldn't create administrator.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <Field
        label="Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
        autoFocus
        disabled={busy}
        error={usernameError}
      />
      <Field
        label="Password"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="new-password"
        disabled={busy}
        error={passwordError}
        hint="12+ characters. Use a passphrase you can remember."
      />
      <Field
        label="Confirm password"
        value={confirm}
        onChange={setConfirm}
        type="password"
        autoComplete="new-password"
        disabled={busy}
        error={confirmError}
      />

      {serverError && (
        <div
          role="alert"
          aria-live="polite"
          style={{
            padding: "10px 12px",
            background: "var(--bg-sunken)",
            border: "var(--border-w) solid var(--danger)",
            borderRadius: "var(--radius)",
            fontSize: "var(--text-sm)",
            color: "var(--danger)",
          }}
        >
          {serverError}
        </div>
      )}

      <PrimaryButton type="submit" disabled={!canSubmit}>
        {busy ? "Creating…" : "Create administrator"}
      </PrimaryButton>
    </form>
  );
}

function ReadyStep({ username }: { username: string }) {
  return (
    <div
      style={{
        marginTop: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          borderRadius: "var(--radius)",
          background: "var(--violet-100)",
          border: "var(--border-w) solid var(--violet-500)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent)",
        }}
      >
        <Check size={26} strokeWidth={2} />
      </span>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-xl)",
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: "var(--tracking-tight)",
        }}
      >
        Welcome, {username}.
      </p>
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--muted)" }}>
        <Sparkles size={12} strokeWidth={1.8} style={{ marginRight: 5, color: "var(--accent)", verticalAlign: "-2px" }} />
        Taking you to your Drive…
      </p>
    </div>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────

function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={disabled ? undefined : "press-sink-lg"}
      style={{
        width: "100%",
        padding: "12px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 700,
        color: "var(--on-violet)",
        background: disabled ? "var(--fg-disabled)" : "var(--violet-500)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  autoFocus,
  disabled,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password";
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string | null;
  hint?: string;
}) {
  const id = `cd-setup-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          color: "var(--ink)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={!!error || undefined}
        style={{
          width: "100%",
          padding: "11px 13px",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-md)",
          color: "var(--ink)",
          background: "var(--bg-surface)",
          border: `var(--border-w) solid ${error ? "var(--danger)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          outline: "none",
          transition: "border-color 150ms, box-shadow 150ms",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--violet-500)";
          e.currentTarget.style.boxShadow = "2px 2px 0 0 var(--violet-500)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      {error ? (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--danger)" }}>{error}</div>
      ) : hint ? (
        <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--muted)" }}>{hint}</div>
      ) : null}
    </div>
  );
}

// Cheap "have they typed anything yet?" heuristic so we don't yell at the
// user before they've started filling in the form.
function touched(v: string): boolean {
  return v.length > 0;
}
