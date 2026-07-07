import type { ReactNode } from "react";

/** Keyboard chip — thin wrapper over the `.kbd` utility in tokens.css. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
