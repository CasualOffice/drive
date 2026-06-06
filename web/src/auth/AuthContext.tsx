import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import * as api from "../api/client.ts";

export type AuthStatus =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authed"; me: api.Me };

interface AuthCtx {
  status: AuthStatus;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: "loading" });

  // Bootstrap: hit /api/me to see if a session cookie is already valid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api.me();
        if (!cancelled) setStatus({ kind: "authed", me });
      } catch {
        if (!cancelled) setStatus({ kind: "anonymous" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    await api.signIn(username, password);
    const me = await api.me();
    setStatus({ kind: "authed", me });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setStatus({ kind: "anonymous" });
    }
  }, []);

  return <Ctx.Provider value={{ status, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth() outside AuthProvider");
  return v;
}
