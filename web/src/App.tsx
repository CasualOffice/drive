import { useEffect, useState } from "react";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "./auth/AuthContext.tsx";
import { FileFullscreen } from "./pages/FileFullscreen.tsx";
import { Recipient } from "./pages/Recipient.tsx";
import { Setup } from "./pages/Setup.tsx";
import { SignIn } from "./pages/SignIn.tsx";
import { Shell } from "./pages/Shell.tsx";
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

  const token = shareToken();
  if (token) return <Recipient token={token} />;

  const { status } = useAuth();
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
  // Authed paths.
  const fileId = fileRouteId();
  if (fileId) return <FileFullscreen fileId={fileId} />;
  return <Shell />;
}

export function App() {
  return (
    <AuthProvider>
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
            background: "var(--ink)",
            color: "var(--paper)",
            border: "none",
            borderRadius: 13,
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            padding: "12px 18px",
            boxShadow: "0 10px 30px rgba(26,26,30,.3)",
          },
        }}
      />
      </AuthProvider>
  );
}
