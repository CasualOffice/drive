/**
 * MU1 Phase 1b — workspace invite dialog.
 *
 * Spec: [[workspace-invitations]] memory entry.
 *
 * Two-step modal:
 *   1. Configure (role, expiry, reuse) → POST /api/workspaces/{id}/invitations.
 *   2. Display the resulting URL with a copy button.
 *
 * Role is fixed to "member" in v0.X (Admin invitations land with MU2's
 * role-tier overhaul). The reuse radio mirrors the locked decision:
 * "One person" (single-use) is the default; "Up to N people" exposes a
 * numeric cap.
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Link2, Users } from "lucide-react";
import { toast } from "sonner";

import { createInvitation, type Workspace } from "../api/client.ts";

interface Props {
  workspace: Workspace | null;
  open: boolean;
  onClose: () => void;
}

type ExpiryChoice = "24h" | "7d" | "30d" | "never";
type ReuseChoice = "one" | "many";

export function InviteDialog({ workspace, open, onClose }: Props) {
  const [expiry, setExpiry] = useState<ExpiryChoice>("7d");
  const [reuse, setReuse] = useState<ReuseChoice>("one");
  const [maxUses, setMaxUses] = useState<number>(10);
  const [creating, setCreating] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  // Reset every time the dialog opens — picking a NEW invite for the
  // same workspace shouldn't fall back to the prior link.
  useEffect(() => {
    if (open) {
      setExpiry("7d");
      setReuse("one");
      setMaxUses(10);
      setCreatedUrl(null);
      setCopied(false);
    }
  }, [open]);

  async function generate() {
    if (!workspace) return;
    setCreating(true);
    try {
      const body = {
        role: "member",
        expires_in_hours: expiryToHours(expiry),
        max_uses: reuse === "one" ? 1 : Math.max(2, Math.min(1000, maxUses)),
      };
      const created = await createInvitation(workspace.id, body);
      const url = `${window.location.origin}/invite/${encodeURIComponent(created.token)}`;
      setCreatedUrl(url);
      // Auto-select the URL on mount so a Cmd-C lands without an
      // extra click — Linear / Notion both do this.
      requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't create the invite";
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  async function copyToClipboard() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
      toast.success("Invite link copied");
      // Revert the inline indicator after a beat so the next copy
      // still feels responsive.
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — select the URL and copy manually");
      urlInputRef.current?.select();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cd-dialog-overlay" />
        <Dialog.Content
          className="cd-dialog-content"
          style={{ maxWidth: 460 }}
          onOpenAutoFocus={(e) => {
            // Generated step: focus the URL input so it's selected
            // for immediate Cmd-C. Configure step: let the dialog's
            // first focusable element take focus naturally.
            if (createdUrl) {
              e.preventDefault();
              urlInputRef.current?.focus();
              urlInputRef.current?.select();
            }
          }}
        >
          <div className="cd-dialog-header">
            <span className="cd-dialog-icon" aria-hidden="true">
              <Users size={15} strokeWidth={1.8} />
            </span>
            <Dialog.Title className="cd-dialog-title">
              {createdUrl ? "Invite link ready" : `Invite to ${workspace?.name ?? "workspace"}`}
            </Dialog.Title>
          </div>

          {createdUrl ? (
            <div>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--muted)",
                  margin: "0 0 14px",
                  lineHeight: 1.5,
                }}
              >
                Share this link with the person you want to invite. They'll join
                as a Member once they open it and sign in.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={urlInputRef}
                  type="text"
                  readOnly
                  value={createdUrl}
                  className="cd-dialog-input"
                  style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--primary"
                  onClick={copyToClipboard}
                  style={{ flexShrink: 0 }}
                >
                  {copied ? (
                    <>
                      <Check size={13} strokeWidth={2} />
                      &nbsp;Copied
                    </>
                  ) : (
                    <>
                      <Copy size={13} strokeWidth={1.8} />
                      &nbsp;Copy
                    </>
                  )}
                </button>
              </div>
              <div className="cd-dialog-actions">
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--ghost"
                  onClick={onClose}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void generate();
              }}
            >
              <Section label="Expires">
                <RadioRow
                  name="expiry"
                  value={expiry}
                  onChange={(v) => setExpiry(v as ExpiryChoice)}
                  options={[
                    { value: "24h", label: "24 hours" },
                    { value: "7d", label: "7 days" },
                    { value: "30d", label: "30 days" },
                    { value: "never", label: "Never" },
                  ]}
                />
              </Section>

              <Section label="Who can use it">
                <RadioRow
                  name="reuse"
                  value={reuse}
                  onChange={(v) => setReuse(v as ReuseChoice)}
                  options={[
                    { value: "one", label: "One person" },
                    { value: "many", label: "Multiple people" },
                  ]}
                />
                {reuse === "many" && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <label
                      htmlFor="cd-invite-max-uses"
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--muted)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Up to
                    </label>
                    <input
                      id="cd-invite-max-uses"
                      type="number"
                      min={2}
                      max={1000}
                      value={maxUses}
                      onChange={(e) => setMaxUses(Number.parseInt(e.target.value, 10) || 2)}
                      className="cd-dialog-input"
                      style={{ width: 80 }}
                    />
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>
                      people
                    </span>
                  </div>
                )}
              </Section>

              <div className="cd-dialog-actions">
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--ghost"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cd-dialog-btn cd-dialog-btn--primary"
                  disabled={creating || !workspace}
                >
                  <Link2 size={13} strokeWidth={1.8} />
                  &nbsp;{creating ? "Generating…" : "Generate link"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function expiryToHours(c: ExpiryChoice): number | null {
  switch (c) {
    case "24h":
      return 24;
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
    case "never":
      return null;
  }
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--muted)",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function RadioRow<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={name} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="press-sink"
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              border: `var(--border-w) solid ${active ? "var(--violet-500)" : "var(--border)"}`,
              background: active ? "var(--violet-100)" : "var(--bg-surface)",
              color: active ? "var(--violet-600)" : "var(--ink)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
