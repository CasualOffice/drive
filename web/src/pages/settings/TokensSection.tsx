/**
 * Tokens & sessions — real (tokens half). Manage personal access tokens (PATs):
 * bearer credentials that let a headless agent reach the MCP endpoint
 * (`/api/mcp`) without a browser session. The plaintext is shown once, on
 * create; the server stores only its hash. Revocation is immediate.
 *
 * Matches the dense Settings system: hairline cards, 28px controls, violet the
 * sole chroma, StatusChip so state never rides on colour alone.
 */
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { Check, Clock, Copy, Key, ShieldOff, Trash2 } from "lucide-react";

import {
  ApiError,
  createToken,
  listTokens,
  revokeToken,
  type CreatedToken,
  type TokenInfo,
} from "../../api/client.ts";
import { StatusChip } from "../../components/ds/StatusChip.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";
import { Button, ErrorBand, Field, STROKE } from "./controls.tsx";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "Too long"),
  expires_in_days: z
    .union([z.literal(""), z.coerce.number().int().positive().max(3650)])
    .optional(),
});
type FormValues = z.infer<typeof schema>;

export function TokensSection() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The just-created token's plaintext — the one and only time it's shown.
  const [fresh, setFresh] = useState<CreatedToken | null>(null);

  const refresh = async () => {
    try {
      setTokens(await listTokens());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as ApiError).message ?? "Could not load tokens.");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <SettingsHeader
        title="Tokens & sessions"
        description="Personal access tokens let scripts and agents reach the MCP endpoint without your browser session. Each is shown once and can be revoked anytime."
      />

      <CreateTokenCard
        onCreated={(t) => {
          setFresh(t);
          void refresh();
        }}
      />

      {fresh && <FreshTokenCard token={fresh} onDismiss={() => setFresh(null)} />}

      <SettingsCard
        title="Your tokens"
        subtitle="Every token you've issued, newest first. Revoked and expired tokens stay listed for your records."
      >
        {loadError ? (
          <ErrorBand>{loadError}</ErrorBand>
        ) : tokens === null ? (
          <Muted>Loading…</Muted>
        ) : tokens.length === 0 ? (
          <Muted>No tokens yet. Create one above to connect an agent.</Muted>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {tokens.map((t) => (
              <TokenRow key={t.id} token={t} onRevoked={() => void refresh()} />
            ))}
          </ul>
        )}
      </SettingsCard>
    </>
  );
}

function CreateTokenCard({ onCreated }: { onCreated: (t: CreatedToken) => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<FormValues>({ mode: "onBlur", defaultValues: { name: "", expires_in_days: "" } });
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) return;
    const days =
      typeof parsed.data.expires_in_days === "number" ? parsed.data.expires_in_days : undefined;
    try {
      const created = await createToken(parsed.data.name, days);
      toast.success("Token created. Copy it now — it won't be shown again.");
      reset({ name: "", expires_in_days: "" });
      onCreated(created);
    } catch (err) {
      const e = err as ApiError;
      const body = e.body as { error?: string } | null;
      setServerError(body?.error ?? e.message ?? "Could not create the token.");
    }
  }

  return (
    <SettingsCard
      title="Create a token"
      subtitle="Give it a name you'll recognise. Set an expiry, or leave blank for a token that never expires."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field
          label="Name"
          placeholder="laptop CLI"
          autoComplete="off"
          error={errors.name?.message}
          {...register("name")}
        />
        <Field
          label="Expires in (days)"
          type="number"
          min={1}
          max={3650}
          placeholder="never"
          error={errors.expires_in_days?.message}
          hint="Optional. Leave blank for no expiry."
          {...register("expires_in_days")}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-4)" }}>
          <Button type="submit" variant="primary" disabled={!isDirty || !isValid || isSubmitting} aria-busy={isSubmitting}>
            <Key size={14} strokeWidth={STROKE} />
            {isSubmitting ? "Creating…" : "Create token"}
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

/** The one-time reveal of a freshly minted token, with copy-to-clipboard. */
function FreshTokenCard({ token, onDismiss }: { token: CreatedToken; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      toast.success("Copied to clipboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  };

  return (
    <SettingsCard
      title={`New token: ${token.name}`}
      status={
        <StatusChip
          tone="attention"
          icon={<ShieldOff size={13} strokeWidth={STROKE} />}
          label="Shown once"
          title="This is the only time the token is shown. Copy it now."
        />
      }
      subtitle="Copy this now — for your security it can't be shown again. If you lose it, revoke it and create a new one."
      action={
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <code
          data-testid="fresh-token"
          style={{
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            whiteSpace: "nowrap",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--bg-sunken)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "var(--text-sm)",
            color: "var(--fg-default)",
          }}
        >
          {token.token}
        </code>
        <Button type="button" variant="secondary" onClick={copy} data-testid="copy-token">
          {copied ? <Check size={14} strokeWidth={STROKE} /> : <Copy size={14} strokeWidth={STROKE} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function TokenRow({ token, onRevoked }: { token: TokenInfo; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const revoked = token.revoked_at !== null;
  const expired = !revoked && !token.active;

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await revokeToken(token.id);
      toast.success(`Revoked “${token.name}”.`);
      onRevoked();
    } catch (err) {
      toast.error((err as ApiError).message ?? "Could not revoke the token.");
      setBusy(false);
    }
  };

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-md)",
        opacity: token.active ? 1 : 0.7,
      }}
    >
      <span aria-hidden style={{ color: token.active ? "var(--violet-500)" : "var(--fg-subtle)", flexShrink: 0 }}>
        <Key size={16} strokeWidth={2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontWeight: "var(--weight-medium)", fontSize: "var(--text-md)", color: "var(--fg-default)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {token.name}
          </span>
          {token.active ? (
            <StatusChip tone="verified" icon={<Check size={12} strokeWidth={STROKE} />} label="Active" />
          ) : revoked ? (
            <StatusChip tone="danger" icon={<ShieldOff size={12} strokeWidth={STROKE} />} label="Revoked" />
          ) : (
            <StatusChip tone="attention" icon={<Clock size={12} strokeWidth={STROKE} />} label="Expired" />
          )}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", marginTop: 2 }}>
          Created {fmtDate(token.created_at)}
          {" · "}
          {token.last_used_at ? `last used ${fmtDate(token.last_used_at)}` : "never used"}
          {token.expires_at ? ` · ${expired ? "expired" : "expires"} ${fmtDate(token.expires_at)}` : ""}
        </div>
      </div>
      {token.active && (
        <Button type="button" variant="danger" size="sm" onClick={revoke} disabled={busy} aria-busy={busy} data-testid="revoke-token">
          <Trash2 size={13} strokeWidth={STROKE} />
          {busy ? "Revoking…" : "Revoke"}
        </Button>
      )}
    </li>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>{children}</div>;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
