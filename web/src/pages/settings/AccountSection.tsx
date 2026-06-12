/**
 * Account section — real. Change password + sign out other sessions.
 *
 * Per spec: validates on blur, disabled Save until dirty+valid, sonner toast
 * on success, inline error band on failure (aria-live).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

import { ApiError, changePassword } from "../../api/client.ts";
import { useAuth } from "../../auth/AuthContext.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";

const schema = z
  .object({
    old_password: z.string().min(1, "Required"),
    new_password: z.string().min(12, "At least 12 characters"),
    confirm: z.string().min(1, "Required"),
  })
  .refine((d) => d.new_password === d.confirm, {
    path: ["confirm"],
    message: "Doesn't match the new password",
  })
  .refine((d) => d.new_password !== d.old_password, {
    path: ["new_password"],
    message: "Must differ from current password",
  });

type FormValues = z.infer<typeof schema>;

export function AccountSection() {
  const { status } = useAuth();
  const username = status.kind === "authed" ? status.me.admin : "—";

  return (
    <>
      <SettingsHeader
        title="Account"
        description="Your sign-in credentials and the sessions currently signed in to this workspace."
      />

      <SettingsCard title="Signed in as" subtitle="The username Drive uses to identify you across this workspace.">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 14px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--line)",
            borderRadius: 11,
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--accent), var(--accent-bright))",
              color: "var(--paper)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {username.charAt(0).toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: "var(--text-md)" }}>{username}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>Workspace administrator</div>
          </div>
        </div>
      </SettingsCard>

      <ChangePasswordCard />

      <SettingsCard
        title="Other sessions"
        subtitle="Changing your password automatically signs out every other device. There is no per-device list in v0."
      >
        <div style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
          Per-device session management ships in v0.2.
        </div>
      </SettingsCard>
    </>
  );
}

function ChangePasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<FormValues>({
    mode: "onBlur",
    defaultValues: { old_password: "", new_password: "", confirm: "" },
  });
  const [reveal, setReveal] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) return;
    try {
      await changePassword(values.old_password, values.new_password);
      toast.success("Password updated. Other sessions signed out.");
      reset({ old_password: "", new_password: "", confirm: "" });
    } catch (err) {
      const e = err as ApiError;
      const body = e.body as { error?: string } | null;
      setServerError(body?.error ?? e.message ?? "Could not update password.");
    }
  }

  return (
    <SettingsCard
      title="Change password"
      subtitle="At least 12 characters. Changing your password signs out every other device."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field
          label="Current password"
          type={reveal ? "text" : "password"}
          autoComplete="current-password"
          error={errors.old_password?.message}
          {...register("old_password")}
        />
        <Field
          label="New password"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          error={errors.new_password?.message}
          hint="12+ characters. Use a passphrase you can remember."
          {...register("new_password")}
        />
        <Field
          label="Confirm new password"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register("confirm")}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 6,
              borderRadius: 8,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              color: "var(--muted)",
            }}
          >
            {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
            {reveal ? "Hide" : "Show"} passwords
          </button>

          <button
            type="submit"
            disabled={!isDirty || !isValid || isSubmitting}
            style={{
              border: "none",
              cursor: !isDirty || !isValid || isSubmitting ? "not-allowed" : "pointer",
              padding: "10px 18px",
              borderRadius: 11,
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              background: !isDirty || !isValid || isSubmitting ? "var(--line-strong)" : "var(--ink)",
              color: "var(--paper)",
              opacity: !isDirty || !isValid || isSubmitting ? 0.7 : 1,
              transition: "background 150ms, opacity 150ms",
            }}
          >
            {isSubmitting ? "Saving…" : "Save"}
          </button>
        </div>

        {serverError && (
          <div
            role="alert"
            aria-live="polite"
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "rgba(178, 36, 36, 0.06)",
              border: "1px solid rgba(178, 36, 36, 0.25)",
              borderRadius: 10,
              fontSize: "var(--text-sm)",
              color: "var(--danger, #B22424)",
            }}
          >
            {serverError}
          </div>
        )}
      </form>
    </SettingsCard>
  );
}

const Field = (() => {
  type Props = React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    error?: string;
    hint?: string;
  };
  return Object.assign(
    function Field({ label, error, hint, ...input }: Props) {
      const id = `cd-fld-${label.replace(/\s+/g, "-").toLowerCase()}`;
      return (
        <div style={{ marginBottom: 14 }}>
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
            {...input}
            style={{
              display: "block",
              width: "100%",
              padding: "10px 12px",
              border: `1px solid ${error ? "var(--danger, #B22424)" : "var(--line)"}`,
              borderRadius: 10,
              background: "var(--paper)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              color: "var(--ink)",
              outline: "none",
              transition: "border-color 150ms, box-shadow 150ms",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--ink)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(15, 23, 42,.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = error ? "var(--danger, #B22424)" : "var(--line)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          {error ? (
            <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--danger, #B22424)" }}>
              {error}
            </div>
          ) : hint ? (
            <div style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--muted)" }}>{hint}</div>
          ) : null}
        </div>
      );
    },
    { displayName: "SettingsField" },
  );
})();
