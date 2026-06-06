import { useEffect, useRef, useState } from "react";
import { LogOut, Search, User } from "lucide-react";

import { useAuth } from "../auth/AuthContext.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export function TopBar() {
  const { status, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const monogram =
    status.kind === "authed" ? status.me.admin.charAt(0).toUpperCase() : "?";

  return (
    <header
      style={{
        height: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 var(--space-6)",
        background: "var(--bg-default)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <SearchTrigger />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <ThemeToggle />
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Account menu"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "9999px",
              background: "var(--bg-subtle)",
              color: "var(--fg-default)",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-semibold)",
            }}
          >
            {monogram}
          </button>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                minWidth: "200px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-lg)",
                padding: "var(--space-1)",
                zIndex: 1000,
              }}
            >
              <MenuItem icon={<User size={14} />} label={status.kind === "authed" ? status.me.admin : "Account"} disabled />
              <Separator />
              <MenuItem
                icon={<LogOut size={14} />}
                label="Sign out"
                chord="⇧⌘Q"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        // Cmd-K palette is Phase 2; for now this is a placeholder.
      }}
      disabled
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "clamp(320px, 40vw, 560px)",
        height: "32px",
        padding: "0 var(--space-3)",
        background: "var(--bg-subtle)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
        color: "var(--fg-muted)",
        fontSize: "var(--text-sm)",
        fontFamily: "var(--font-sans)",
        cursor: "default",
      }}
    >
      <Search size={14} strokeWidth={2} />
      <span>Search files or run a command…</span>
      <span
        className="tabular-nums"
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          background: "var(--bg-default)",
          padding: "2px 6px",
          borderRadius: "var(--radius-xs)",
          color: "var(--fg-subtle)",
        }}
      >
        ⌘K
      </span>
    </button>
  );
}

function MenuItem({
  icon,
  label,
  chord,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  chord?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        padding: "var(--space-2) var(--space-3)",
        background: "transparent",
        color: disabled ? "var(--fg-subtle)" : "var(--fg-default)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--text-sm)",
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
      onMouseOver={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {chord && (
        <span
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--fg-subtle)",
          }}
        >
          {chord}
        </span>
      )}
    </button>
  );
}

function Separator() {
  return (
    <div
      role="separator"
      style={{
        height: "1px",
        background: "var(--border-default)",
        margin: "var(--space-1) 0",
      }}
    />
  );
}
