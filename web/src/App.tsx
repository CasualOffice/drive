import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import { AmbientGround } from "./components/AmbientGround.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { FileFullscreen } from "./pages/FileFullscreen.tsx";
import { InviteAccept } from "./pages/InviteAccept.tsx";
import { Recipient } from "./pages/Recipient.tsx";
import { Setup } from "./pages/Setup.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { Shell } from "./pages/Shell.tsx";
import { VersionHistoryPage } from "./pages/VersionHistoryPage.tsx";
import { PresenceProvider } from "./state/PresenceContext.tsx";
import { WorkspaceProvider } from "./state/WorkspaceContext.tsx";

/** Public share-link path: `/s/<token>` — never gated by AuthContext. */
function shareToken(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/s\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** `/file/<id>` fullscreen editor route (ED1 gap a). Auth-gated like
 *  the main Shell; the in-editor page handles its own back-to-Drive
 *  navigation. */
function fileRouteId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/file\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `/document/<id>/history` — the flagship version-history + integrity
 *  surface (UX-18). Auth-gated like the Shell; the page owns its own
 *  back-navigation. */
function historyRouteId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/document\/([^/?#]+)\/history/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `/document/<id>/edit` — Phase-2 (P2.1) canonical embedded-editor
 *  surface: opens the head version in its native editor (Sheet / Docs /
 *  light text) inside the Doc-Hub shell, every save landing as a new
 *  hash-chained version. `/file/<id>` remains as a compatibility alias
 *  for existing open-from-list navigation. */
function editRouteId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/document\/([^/?#]+)\/edit/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** `/invite/<token>` MU1 accept page. Public-safe — the page itself
 *  decides whether to show "Sign in to join" or "Join workspace"
 *  based on current auth status. */
function inviteToken(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/invite\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function Router() {
  // Re-read the pathname on browser back/forward so popstate-driven
  // nav updates which route renders. The `pageKey` state is a cheap
  // way to force re-evaluation without smearing path parsing across
  // every consumer.
  const [, setPageKey] = useState(0);
  useEffect(() => {
    const onPop = () => setPageKey((k) => k + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Rules of Hooks: useAuth() MUST run on every render, before any early
  // return. Previously it sat below the share/invite token returns, so a
  // popstate transition between a token route (hook skipped) and a normal
  // route (hook called) changed the hook count and crashed React.
  const { status } = useAuth();

  const token = shareToken();
  if (token) return <Recipient token={token} />;

  // MU1 — `/invite/<token>` renders BEFORE the auth gate so the
  // peek payload (anonymous-safe) can show before sign-in. The
  // page itself bounces anonymous visitors to sign-in.
  const inviteTok = inviteToken();
  if (inviteTok) return <InviteAccept token={inviteTok} />;

  if (status.kind === "loading") {
    return (
      <div
        className="h-full w-full flex items-center justify-center"
        style={{ background: "var(--paper)" }}
      />
    );
  }
  if (status.kind === "needs-setup") return <Setup />;
  if (status.kind !== "authed") return <SignIn />;
  // Authed full-screen routes. These sit OUTSIDE the Shell (no sidebar to
  // preserve) and lazy-load the heaviest chunks in the app (~2.5 MB editor
  // bundles) — the single most likely lazy-load to fail on a flaky network or
  // after a redeploy. Wrap each so a chunk failure offers a targeted "Back to
  // Drive" escape instead of stranding the user on a broken editor. `resetKey`
  // is the pathname so opening a different document clears a prior crash.
  const path = window.location.pathname;
  const historyId = historyRouteId();
  if (historyId) return editorRoute(<VersionHistoryPage fileId={historyId} />, path);
  const editId = editRouteId();
  if (editId) return editorRoute(<FileFullscreen fileId={editId} />, path);
  const fileId = fileRouteId();
  if (fileId) return editorRoute(<FileFullscreen fileId={fileId} />, path);
  return <Shell />;
}

/** Wrap a full-screen editor/history route in an error boundary with a
 * back-to-Drive escape (see the call sites for why). */
function editorRoute(el: ReactNode, path: string) {
  return (
    <ErrorBoundary surface="editor" resetKey={path} homeHref="/" homeLabel="Back to Drive">
      {el}
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <AuthProvider>
      {/* UI M6 — immersive ambient ground behind the whole app; the glass
          chrome above blurs it for vibrancy. Fixed, z-index:-1, inert. */}
      <AmbientGround />
      <WorkspaceProvider>
        {/* RT2 — PresenceContext subscribes to the active workspace's
            SSE stream + beats every 25s. Sits inside WorkspaceProvider
            because workspaceId is the route key; outside Router so the
            same connection survives navigation between Files / Notes /
            Activity / etc. */}
        <PresenceProvider>
          <Router />
        </PresenceProvider>
      </WorkspaceProvider>
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: "var(--bg-surface)",
            color: "var(--fg-default)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            padding: "10px 14px",
            boxShadow: "var(--shadow-lg)",
          },
        }}
      />
      </AuthProvider>
  );
}
