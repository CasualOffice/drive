import { Clock, Home, Share2, Star, Trash2 } from "lucide-react";

import { Logo } from "./Logo.tsx";

interface NavItem {
  id: "home" | "recent" | "starred" | "shared" | "trash";
  label: string;
  icon: typeof Home;
  badge?: number;
}

const NAV: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "recent", label: "Recent", icon: Clock },
  { id: "starred", label: "Starred", icon: Star },
  { id: "shared", label: "Shared", icon: Share2 },
  { id: "trash", label: "Trash", icon: Trash2 },
];

export function Sidebar({
  current,
  onSelect,
}: {
  current: NavItem["id"];
  onSelect: (id: NavItem["id"]) => void;
}) {
  return (
    <aside
      style={{
        width: "240px",
        flexShrink: 0,
        background: "var(--bg-canvas)",
        borderRight: "1px solid var(--border-default)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: "48px",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "0 var(--space-4)",
          borderBottom: "1px solid var(--border-default)",
          color: "var(--fg-default)",
        }}
      >
        <Logo size={20} />
        <span
          style={{
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          Casual Drive
        </span>
      </div>

      <nav style={{ padding: "var(--space-2)", flex: 1 }}>
        {NAV.map((item) => {
          const active = item.id === current;
          const enabled = item.id === "home" || item.id === "trash";
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && onSelect(item.id)}
              className="cd-nav-row"
              data-active={active}
              style={{
                position: "relative",
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "0 var(--space-3)",
                height: "32px",
                background: active ? "var(--bg-selected)" : "transparent",
                color: active
                  ? "var(--accent)"
                  : enabled
                    ? "var(--fg-default)"
                    : "var(--fg-subtle)",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: enabled ? "pointer" : "default",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                fontFamily: "var(--font-sans)",
                textAlign: "left",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
            >
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 6,
                    bottom: 6,
                    width: "2px",
                    background: "var(--accent)",
                    borderRadius: "2px",
                  }}
                />
              )}
              <Icon size={16} strokeWidth={2} />
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className="tabular-nums"
                  style={{
                    marginLeft: "auto",
                    fontSize: "var(--text-xs)",
                    color: "var(--fg-muted)",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <style>
        {`
          .cd-nav-row:not([data-active="true"]):not(:disabled):hover {
            background: var(--bg-hover) !important;
          }
          .cd-nav-row:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: -2px;
          }
        `}
      </style>
    </aside>
  );
}

export type NavId = NavItem["id"];
