import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import * as api from "../api/client.ts";
import { baseApi } from "../store/baseApi.ts";
import { store } from "../store/store.ts";

// Session reads flow through RTK Query so the result is cached + inspectable and
// future components can `useMeQuery()`/`useSetupStatusQuery()` off the same
// entry. This provider keeps its exact bootstrap/sign-in/out control flow — it
// just sources the data imperatively from the store instead of calling the raw
// client, so behavior is unchanged while the session slice moves into Redux.
const fetchMe = () =>
  store.dispatch(baseApi.endpoints.me.initiate(undefined, { forceRefetch: true })).unwrap();
const fetchSetupStatus = () =>
  store
    .dispatch(baseApi.endpoints.setupStatus.initiate(undefined, { forceRefetch: true }))
    .unwrap();

export type AuthStatus =
  | { kind: "loading" }
  | { kind: "needs-setup" }
  | { kind: "anonymous" }
  | { kind: "authed"; me: api.Me };

interface AuthCtx {
  status: AuthStatus;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called after the wizard completes — the response already minted a
   * session, so this just refreshes the bootstrap state. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: "loading" });

  // Bootstrap order: setup-status first (so a fresh install renders the
  // wizard rather than a sign-in card the operator can't satisfy), then
  // /api/me to decide between anonymous and authed.
  const bootstrap = useCallback(async () => {
    try {
      const setup = await fetchSetupStatus();
      if (setup.needs_setup) {
        setStatus({ kind: "needs-setup" });
        return;
      }
    } catch {
      // Older backends without the setup endpoint fall through — treat as
      // already-initialized and go straight to the /api/me check.
    }
    try {
      const me = await fetchMe();
      setStatus({ kind: "authed", me });
    } catch {
      setStatus({ kind: "anonymous" });
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      // Only this call validates credentials — let it throw so the sign-in
      // form shows "wrong username or password". Once it resolves the session
      // cookie is set and we ARE authenticated.
      await api.signIn(username, password);
      try {
        const me = await fetchMe();
        setStatus({ kind: "authed", me });
      } catch {
        // Session is live but the profile fetch blipped (network/500). Do NOT
        // report a sign-in failure — re-derive status instead of throwing.
        await bootstrap();
      }
    },
    [bootstrap],
  );

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      // Drop the cached session so any RTK Query consumer re-derives it.
      store.dispatch(baseApi.util.invalidateTags(["Session"]));
      setStatus({ kind: "anonymous" });
    }
  }, []);

  return (
    <Ctx.Provider value={{ status, signIn, signOut, refresh: bootstrap }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth() outside AuthProvider");
  return v;
}
