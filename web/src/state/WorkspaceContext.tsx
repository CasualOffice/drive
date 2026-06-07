/**
 * WorkspaceContext — single source of truth for the active workspace id.
 * Spec: docs/ux/13-workspaces-surface.md.
 *
 * Backed by localStorage (`cd-workspace-id-v1`) so the choice survives
 * reloads, and by a `storage` event listener so cross-tab switches stay
 * in sync. The WorkspaceSwitcher publishes via setWorkspaceId; consumers
 * (Files, search, upload) subscribe via useActiveWorkspaceId.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const KEY = "cd-workspace-id-v1";

type Ctx = {
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable (private mode, quota) — skip */
  }
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceId, setIdState] = useState<string | null>(() => readStored());

  useEffect(() => {
    // Cross-tab sync. Only repaint when the key actually changes.
    function onStorage(e: StorageEvent) {
      if (e.key !== KEY) return;
      setIdState(e.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setWorkspaceId = useCallback((id: string | null) => {
    setIdState((prev) => {
      if (prev === id) return prev;
      writeStored(id);
      return id;
    });
  }, []);

  const value = useMemo(() => ({ workspaceId, setWorkspaceId }), [workspaceId, setWorkspaceId]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useActiveWorkspaceId(): string | null {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useActiveWorkspaceId must be used within WorkspaceProvider");
  return ctx.workspaceId;
}

export function useWorkspaceMutator(): (id: string | null) => void {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspaceMutator must be used within WorkspaceProvider");
  return ctx.setWorkspaceId;
}
