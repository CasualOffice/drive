/**
 * MU1 Phase 1b — `/invite/<token>` accept page.
 *
 * Spec: [[workspace-invitations]] memory entry.
 *
 * Renders on any visitor (signed-in OR anonymous). The peek payload
 * is anonymous-safe — the server only returns workspace name +
 * inviter username + role + remaining-uses count, never the token.
 *
 * Signed-in path: click "Join workspace" → POST accept → toast +
 * route to /home. Already-member returns 200 with
 * `already_member: true` and we skip the noise.
 *
 * Anonymous path (Phase 1b): "Sign in to join" button stashes the
 * invite URL in `sessionStorage.returnTo` and bounces to the sign-in
 * card. After auth, AuthContext or this page restores the URL.
 *
 * Magic-link auto-create (anonymous → mint user + session) is
 * Phase 1d — not wired here.
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import {
  acceptInvitation,
  peekInvitation,
  type InvitationPeek,
} from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { useWorkspaceMutator } from "../state/WorkspaceContext.tsx";

interface Props {
  token: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; peek: InvitationPeek }
  // `transient` splits a network drop / 5xx (retryable) from a genuinely
  // unavailable invite (expired, revoked, full — a 4xx) so we don't tell a
  // valid invitee their link is dead just because the server blipped.
  | { kind: "error"; transient: boolean };

export function InviteAccept({ token }: Props) {
  const { status, refresh: refreshAuth } = useAuth();
  const setActive = useWorkspaceMutator();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [accepting, setAccepting] = useState(false);

  // Send an anonymous visitor to sign-in, remembering the invite URL so we can
  // bounce them back here to accept once they're authenticated.
  function goSignIn() {
    try {
      sessionStorage.setItem("returnTo", window.location.pathname + window.location.search);
    } catch {
      /* private mode — sign-in still works, we just land on the app root */
    }
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  // Fetch the peek payload — anonymous-safe so we can run this
  // before knowing the visitor's auth state.
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const peek = await peekInvitation(token);
      setState({ kind: "ready", peek });
    } catch (err) {
      // A real fetch failure has no status; an HTTP error carries one.
      const status = (err as { status?: number }).status;
      setState({ kind: "error", transient: !status || status >= 500 });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onJoin() {
    setAccepting(true);
    try {
      const resp = await acceptInvitation(token);
      const workspaceName =
        state.kind === "ready" ? state.peek.workspace_name : "workspace";
      if (resp.already_member) {
        toast.message("You're already a member of this workspace");
      } else if (resp.created_user) {
        // MU1 1d — magic-link auto-create. The server minted a
        // fresh account + session for us. Toast the auto-generated
        // username so the new user knows what they're signed in as
        // (they can rename themselves in Settings → Profile).
        toast.success(
          `Welcome to ${workspaceName}. Your username is ${resp.created_user.username}.`,
          { duration: 6000 },
        );
        // Re-bootstrap AuthContext so /api/me reflects the new
        // session cookie that came back with the accept response.
        // Without this the SPA would still think it's anonymous
        // until the next reload.
        await refreshAuth();
      } else {
        toast.success(`Joined ${workspaceName}`);
      }
      setActive(resp.workspace_id);
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't accept the invite";
      toast.error(message);
    } finally {
      setAccepting(false);
    }
  }

  function onDismiss() {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--paper)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <section
        aria-labelledby="invite-title"
        style={{
          maxWidth: 460,
          width: "100%",
          padding: "28px 30px",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius-xl)",
          background: "var(--card)",
          boxShadow: "var(--shadow-lg)",
          fontFamily: "var(--font-sans)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 30,
            height: 30,
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-sm)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>

        <div
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius)",
            background: "var(--violet-100)",
            border: "var(--border-w) solid var(--violet-500)",
            color: "var(--violet-600)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <Building2 size={20} strokeWidth={1.8} />
        </div>

        {state.kind === "loading" && (
          <>
            <h1
              id="invite-title"
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Checking invitation…
            </h1>
            <p style={{ marginTop: 8, color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              One second while we look this up.
            </p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <h1
              id="invite-title"
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {state.transient ? "Something went wrong" : "This invitation isn't available"}
            </h1>
            <p
              style={{
                marginTop: 8,
                color: "var(--muted)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.5,
              }}
            >
              {state.transient
                ? "We couldn't reach the server. Check your connection and try again."
                : "It may have expired, been revoked, or all the slots may already be filled. Ask whoever sent it to share a fresh link."}
            </p>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="cd-dialog-btn cd-dialog-btn--ghost"
                onClick={onDismiss}
              >
                Back to Drive
              </button>
              {state.transient && (
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--primary"
                  onClick={() => void load()}
                >
                  Try again
                </button>
              )}
            </div>
          </>
        )}

        {state.kind === "ready" && (
          <>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                color: "var(--muted)",
                letterSpacing: "0.02em",
              }}
            >
              {state.peek.inviter_username} invited you to
            </p>
            <h1
              id="invite-title"
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-2xl)",
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {state.peek.workspace_name}
            </h1>
            <p
              style={{
                marginTop: 12,
                color: "var(--muted)",
                fontSize: "var(--text-sm)",
                lineHeight: 1.5,
              }}
            >
              You'll join as a {state.peek.role}.
              {state.peek.expires_at ? (
                <>
                  {" "}
                  This invite expires {formatExpiry(state.peek.expires_at)}.
                </>
              ) : null}
            </p>

            <div style={{ marginTop: 22, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="cd-dialog-btn cd-dialog-btn--ghost"
                onClick={onDismiss}
              >
                Not now
              </button>
              {status.kind === "authed" ? (
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--primary"
                  onClick={onJoin}
                  disabled={accepting}
                >
                  <UserPlus size={13} strokeWidth={1.8} />
                  &nbsp;{accepting ? "Joining…" : "Join workspace"}
                </button>
              ) : (
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--primary"
                  onClick={goSignIn}
                  disabled={status.kind === "loading"}
                >
                  <UserPlus size={13} strokeWidth={1.8} />
                  &nbsp;Sign in to join
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** "expires in 6 days" / "expires in 2 hours" / "expires today". */
function formatExpiry(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "soon";
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "soon";
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 2) return `in ${days} days`;
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours >= 2) return `in ${hours} hours`;
  return "in less than an hour";
}
