import { useState } from "react";
import {
  Activity,
  Clock,
  FileText,
  FolderClosed,
  Gauge,
  Home,
  Lock,
  NotebookPen,
  Plus,
  Settings,
  Share2,
  Sheet,
  Star,
  Trash2,
  Upload,
} from "lucide-react";

import { Logo, Wordmark } from "./Logo.tsx";
import { AvatarStack } from "./AvatarStack.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { WorkspaceSwitcher as RealWorkspaceSwitcher } from "./WorkspaceSwitcher.tsx";

export type NavId =
  | "home"
  | "notes"
  | "recent"
  | "starred"
  | "shared"
  | "trash"
  | "activity"
  | "settings"
  | "admin";

interface NavItem {
  id: NavId;
  label: string;
  icon: typeof Home;
  badge?: number;
  comingSoon?: boolean;
}

const LIBRARY: NavItem[] = [
  { id: "home", label: "My Drive", icon: Home },
  { id: "notes", label: "Notes", icon: NotebookPen },
  { id: "recent", label: "Recent", icon: Clock, comingSoon: true },
  { id: "starred", label: "Starred", icon: Star, comingSoon: true },
  { id: "shared", label: "Shared", icon: Share2, comingSoon: true },
];

const WORKSPACE: NavItem[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "admin", label: "Admin", icon: Gauge },
];

const SYSTEM: NavItem[] = [
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  current,
  onSelect,
  itemCount,
  onNewFolder,
  onUpload,
  onNewDocument,
  onNewSpreadsheet,
  username,
}: {
  current: NavId;
  onSelect: (id: NavId) => void;
  itemCount: number;
  onNewFolder: () => void;
  onUpload: () => void;
  onNewDocument: () => void;
  onNewSpreadsheet: () => void;
  username: string;
  /** Kept for source compatibility with prior callers; no longer rendered
   * in the dense rail (§7). */
  storage?: { usedBytes: number; quotaBytes?: number };
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <aside
      style={{
        // Dark ink rail (§7.1 dark-on-light) — stays dark even when the
        // rest of the app is in light mode.
        width: 240,
        flexShrink: 0,
        height: "100vh",
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "var(--rail)",
        color: "var(--rail-text)",
        borderRight: "1px solid var(--rail-line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 12px" }}>
        {/* Amber square + paper cloud, brand-locked on the dark rail. */}
        <div style={{ color: "var(--accent)", ["--mark-fg" as string]: "#F5F3EE" }}>
          <Logo size={30} />
        </div>
        <div style={{ color: "var(--rail-active-text)" }}>
          <Wordmark tone="rail" />
        </div>
      </div>

      <RealWorkspaceSwitcher />
      <AvatarStack />

      <div style={{ position: "relative", marginTop: 10, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            border: "none",
            cursor: "pointer",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-medium)",
            height: 32,
            padding: "0 12px",
            borderRadius: "var(--radius-sm)",
            transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-instant)",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--accent-hover)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--accent)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "translateY(1px)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "";
          }}
        >
          <Plus size={16} strokeWidth={1.5} />
          <span>New</span>
        </button>
        {menuOpen && (
          <NewMenu
            onClose={() => setMenuOpen(false)}
            onNewFolder={() => {
              setMenuOpen(false);
              onNewFolder();
            }}
            onUpload={() => {
              setMenuOpen(false);
              onUpload();
            }}
            onNewDocument={() => {
              setMenuOpen(false);
              onNewDocument();
            }}
            onNewSpreadsheet={() => {
              setMenuOpen(false);
              onNewSpreadsheet();
            }}
          />
        )}
      </div>

      <Section label="Library">
        {LIBRARY.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={current === item.id}
            badge={item.id === "home" ? itemCount : undefined}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </Section>

      <Section label="Workspace">
        {WORKSPACE.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={current === item.id}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </Section>

      <Section label="System">
        {SYSTEM.map((item) => (
          <NavRow
            key={item.id}
            item={item}
            active={current === item.id}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </Section>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AvatarRow username={username} />
        </div>
        <ThemeToggle />
      </div>

      <EncryptionFooterChip />
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span
        className="caps-label"
        style={{ color: "var(--rail-muted)", padding: "10px 10px 4px" }}
      >
        {label}
      </span>
      <ul
        style={{
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          margin: 0,
          padding: 0,
        }}
      >
        {children}
      </ul>
    </>
  );
}

function NavRow({
  item,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        style={{
          // Active = amber-wash fill + 2px left amber rule + paper text
          // (semibold); idle = transparent + rail-text.
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 28,
          padding: "0 10px",
          borderRadius: "var(--radius-sm)",
          background: active ? "var(--rail-active)" : "transparent",
          color: active ? "var(--rail-active-text)" : "var(--rail-text)",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-base)",
          fontWeight: active ? "var(--weight-semibold)" : "var(--weight-body)",
          textAlign: "left",
          transition: "background var(--dur-base) var(--ease-out), color var(--dur-base)",
        }}
        onMouseOver={(e) => {
          if (!active) e.currentTarget.style.background = "var(--rail-2)";
        }}
        onMouseOut={(e) => {
          if (!active) e.currentTarget.style.background = "transparent";
        }}
      >
        {active && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              top: 4,
              bottom: 4,
              width: 2,
              borderRadius: 2,
              background: "var(--accent)",
            }}
          />
        )}
        <Icon size={16} strokeWidth={1.5} style={{ opacity: active ? 1 : 0.9 }} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.comingSoon && (
          <span className="caps-label" style={{ color: "var(--rail-muted)" }}>
            soon
          </span>
        )}
        {badge !== undefined && badge > 0 && !item.comingSoon && (
          <span
            className="tnum"
            style={{
              fontSize: "var(--text-sm)",
              color: active ? "var(--rail-active-text)" : "var(--rail-muted)",
              opacity: active ? 0.8 : 1,
            }}
          >
            {badge}
          </span>
        )}
      </button>
    </li>
  );
}

/** Always-on trust cue: encryption at rest is a product invariant, so the
 * footer chip reminds the user that empty ≠ unprotected. Non-interactive. */
function EncryptionFooterChip() {
  return (
    <div
      title="All documents are encrypted at rest with AES-256-GCM"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px 4px",
        color: "var(--rail-muted)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-medium)",
        lineHeight: 1.3,
        cursor: "default",
        userSelect: "none",
      }}
    >
      <Lock size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      <span>Encrypted at rest · AES-256-GCM</span>
    </div>
  );
}

function NewMenu({
  onClose,
  onNewFolder,
  onUpload,
  onNewDocument,
  onNewSpreadsheet,
}: {
  onClose: () => void;
  onNewFolder: () => void;
  onUpload: () => void;
  onNewDocument: () => void;
  onNewSpreadsheet: () => void;
}) {
  return (
    <div
      role="menu"
      onMouseLeave={onClose}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        width: "100%",
        background: "var(--bg-raised)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        padding: 4,
        zIndex: 20,
        animation: "cd-menu-in var(--dur-base) var(--ease-out)",
      }}
    >
      <MenuItem icon={<FolderClosed size={16} strokeWidth={1.5} />} label="New folder" onClick={onNewFolder} />
      <MenuItem icon={<FileText size={16} strokeWidth={1.5} />} label="New document" onClick={onNewDocument} />
      <MenuItem icon={<Sheet size={16} strokeWidth={1.5} />} label="New spreadsheet" onClick={onNewSpreadsheet} />
      <MenuItem icon={<Upload size={16} strokeWidth={1.5} />} label="Upload files" onClick={onUpload} />
      <style>{`
        @keyframes cd-menu-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        height: 30,
        padding: "0 10px",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-base)",
        color: "var(--fg-default)",
        textAlign: "left",
        transition: "background var(--dur-fast)",
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: "var(--fg-muted)", display: "inline-flex" }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AvatarRow({ username }: { username: string }) {
  const monogram = username.charAt(0).toUpperCase();
  return (
    <button
      type="button"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 8px",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--dur-fast)",
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--rail-2)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-semibold)",
          fontSize: "var(--text-sm)",
          flexShrink: 0,
        }}
      >
        {monogram}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--rail-active-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {username}
        </span>
      </span>
    </button>
  );
}
