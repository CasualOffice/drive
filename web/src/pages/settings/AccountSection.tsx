/**
 * Account section — real. Change password + sign out other sessions.
 *
 * Per spec: validates on blur, disabled Save until dirty+valid, sonner toast
 * on success, inline error band on failure (aria-live). Dense on-system
 * restyle — 30px fields, 28px amber primary, hairline cards, one Lucide
 * weight. Logic + endpoints unchanged.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

import { ApiError, changePassword } from "../../api/client.ts";
import { useAuth } from "../../auth/AuthContext.tsx";
import { StatusChip } from "../../components/ds/StatusChip.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { Button, ErrorBand, Field, STROKE } from "./controls.tsx";

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

      <SettingsCard title="Signed in as" subtitle="The username Doc-Hub uses to identify you across this workspace.">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-hair)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              background: "var(--accent-wash)",
              color: "var(--amber-700)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-md)",
              flexShrink: 0,
            }}
          >
            {username.charAt(0).toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-md)", color: "var(--fg-default)" }}>
              {username}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>Workspace administrator</div>
          </div>
        </div>
      </SettingsCard>

      <ChangePasswordCard />

      <SettingsCard
        title="Other sessions"
        subtitle="Changing your password automatically signs out every other device. There is no per-device list in v0."
      >
        <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
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
      status={
        <StatusChip
          tone="verified"
          icon={<ShieldCheck size={13} strokeWidth={STROKE} />}
          label="Argon2id"
          title="Passwords are hashed with Argon2id — never stored in the clear."
        />
      }
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
            marginTop: "var(--space-4)",
          }}
        >
          <Button type="button" variant="ghost" size="sm" onClick={() => setReveal((r) => !r)}>
            {reveal ? <EyeOff size={14} strokeWidth={STROKE} /> : <Eye size={14} strokeWidth={STROKE} />}
            {reveal ? "Hide" : "Show"} passwords
          </Button>

          <Button type="submit" variant="primary" disabled={!isDirty || !isValid || isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>

        {serverError && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <ErrorBand>{serverError}</ErrorBand>
          </div>
        )}
      </form>
    </SettingsCard>
  );
}
