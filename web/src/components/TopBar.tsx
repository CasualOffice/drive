import { ChangeEvent } from "react";
import { Grid3x3, HelpCircle, List, Search } from "lucide-react";

import { NotificationsBell } from "./NotificationsBell.tsx";

export type ViewMode = "grid" | "list";

export function TopBar({
  query,
  onQueryChange,
  view,
  onViewChange,
  onShowHelp,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  onShowHelp: () => void;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 26,
      }}
    >
      <div style={{ position: "relative", flex: "1 1 auto", maxWidth: 300, marginLeft: "auto" }}>
        <Search
          size={16}
          strokeWidth={2}
          style={{
            position: "absolute",
            left: 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--muted)",
          }}
        />
        <input
          type="text"
          placeholder="Search files and folders"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
          style={{
            width: "100%",
            border: "1px solid var(--line)",
            background: "var(--card)",
            borderRadius: 12,
            padding: "11px 14px 11px 40px",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-base)",
            color: "var(--ink)",
            outline: "none",
            transition: "border-color 200ms, box-shadow 200ms",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--line-strong)";
            e.currentTarget.style.boxShadow = "0 0 0 4px rgba(26,26,30,.04)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--line)";
            e.currentTarget.style.boxShadow = "";
          }}
        />
      </div>

      <ViewToggle value={view} onChange={onViewChange} />
      <NotificationsBell />
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={onShowHelp}
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          border: "1px solid var(--line)",
          background: "var(--card)",
          color: "var(--muted)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background 150ms, border-color 150ms, color 150ms",
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--ink)";
          e.currentTarget.style.borderColor = "var(--line-strong)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "var(--card)";
          e.currentTarget.style.color = "var(--muted)";
          e.currentTarget.style.borderColor = "var(--line)";
        }}
      >
        <HelpCircle size={17} strokeWidth={1.8} />
      </button>
    </header>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      style={{
        display: "flex",
        border: "1px solid var(--line)",
        borderRadius: 11,
        background: "var(--card)",
        padding: 3,
        gap: 2,
      }}
    >
      <ToggleButton active={value === "grid"} onClick={() => onChange("grid")} title="Grid view">
        <Grid3x3 size={17} strokeWidth={1.8} />
      </ToggleButton>
      <ToggleButton active={value === "list"} onClick={() => onChange("list")} title="List view">
        <List size={17} strokeWidth={1.8} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "var(--ink)" : "transparent",
        cursor: "pointer",
        padding: 8,
        borderRadius: 8,
        display: "flex",
        color: active ? "var(--paper)" : "var(--muted)",
        transition: "background 180ms, color 180ms",
      }}
      onMouseOver={(e) => {
        if (!active) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
