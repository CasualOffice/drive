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
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow)",
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
          fontWeight: 500,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
        }}
      >
        Welcome to Casual Drive
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
              borderRadius: 4,
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
        Casual Drive is a self-hosted, file-centric Drive that opens spreadsheets and documents in the
        Casual Office suite. This is a one-time setup — you&apos;ll create the first administrator account
        and then you&apos;re in.
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
            background: "rgba(220, 38, 38,.06)",
            border: "1px solid rgba(220, 38, 38,.25)",
            borderRadius: 10,
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
          borderRadius: 16,
          background: "var(--accent-muted)",
          border: "1px solid rgba(200, 164, 92, 0.32)",
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
          fontWeight: 500,
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
      style={{
        width: "100%",
        padding: "12px",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        color: "var(--paper)",
        background: disabled ? "rgba(15, 23, 42,.35)" : "var(--ink)",
        border: "none",
        borderRadius: 12,
        cursor: disabled ? "default" : "pointer",
        transition: "background 200ms var(--ease), transform 200ms",
      }}
      onMouseOver={(e) => {
        if (!disabled) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseOut={(e) => (e.currentTarget.style.transform = "")}
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
          background: "var(--paper)",
          border: `1px solid ${error ? "var(--danger)" : "var(--line)"}`,
          borderRadius: 11,
          outline: "none",
          transition: "border-color 150ms, box-shadow 150ms",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--ink)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(15, 23, 42,.08)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--line)";
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
