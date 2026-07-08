import { useState } from "react";
import {
  Activity,
  FileText,
  FolderClosed,
  Gauge,
  Home,
  Lock,
  Plus,
  Settings,
  Sheet,
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

// UI-M6: the coming-soon Recent / Starred / Shared entries are removed —
// dead nav surfaces don't ship. Library is the real, working scope.
const LIBRARY: NavItem[] = [
  { id: "home", label: "My Drive", icon: Home },
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
        // Neobrutalist chrome (ui-system-neobrutal §5): flat solid surface
        // with a hard 2px ink border down the right edge — no glass, no
        // blur, no shadow-float. Theme-adaptive via semantic core tokens.
        width: 240,
        flexShrink: 0,
        height: "100vh",
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        color: "var(--ink-soft)",
        background: "var(--bg-surface)",
        borderRadius: 0,
        borderRight: "var(--border-w) solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 14px" }}>
        {/* Violet square + paper document stack — the single signal color. */}
        <div style={{ color: "var(--violet-500)", ["--mark-fg" as string]: "var(--bg-surface)" }}>
          <Logo size={30} />
        </div>
        <div style={{ color: "var(--ink)" }}>
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
            justifyContent: "center",
            gap: 8,
            width: "100%",
            border: "var(--border-w) solid var(--border)",
            cursor: "pointer",
            background: "var(--violet-500)",
            color: "var(--on-violet)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-bold)",
            height: 38,
            padding: "0 12px",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow)",
            transition: "background var(--dur) var(--ease), transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--violet-600)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "var(--violet-500)";
            e.currentTarget.style.transform = "";
            e.currentTarget.style.boxShadow = "var(--shadow)";
          }}
          onMouseDown={(e) => {
            // The Press — sink into the offset shadow.
            e.currentTarget.style.transform = "var(--lift-press)";
            e.currentTarget.style.boxShadow = "var(--shadow-sm)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "";
            e.currentTarget.style.boxShadow = "var(--shadow)";
          }}
        >
          <Plus size={16} strokeWidth={2.4} />
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
        style={{ color: "var(--fg-subtle)", padding: "10px 10px 4px" }}
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
          // Neobrutalist nav (§5): active = violet-100 fill + 2px ink border
          // + a violet left marker + bold ink label + violet icon. Idle is
          // flat transparent with a 2px transparent border so the active
          // border doesn't shift layout.
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          height: 34,
          padding: "0 10px 0 12px",
          borderRadius: "var(--radius-sm)",
          background: active ? "var(--violet-100)" : "transparent",
          color: active ? "var(--ink)" : "var(--ink-soft)",
          border: `var(--border-w) solid ${active ? "var(--border)" : "transparent"}`,
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-base)",
          fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
          textAlign: "left",
          transition: "background var(--dur) var(--ease), color var(--dur) var(--ease)",
        }}
        onMouseOver={(e) => {
          if (!active) e.currentTarget.style.background = "var(--bg-hover)";
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
              left: -2,
              top: -2,
              bottom: -2,
              width: 4,
              borderTopLeftRadius: "var(--radius-sm)",
              borderBottomLeftRadius: "var(--radius-sm)",
              background: "var(--violet-500)",
            }}
          />
        )}
        <Icon
          size={16}
          strokeWidth={active ? 2.4 : 2}
          style={{ color: active ? "var(--violet-500)" : "currentColor", opacity: active ? 1 : 0.9 }}
        />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.comingSoon && (
          <span className="caps-label" style={{ color: "var(--fg-subtle)" }}>
            soon
          </span>
        )}
        {badge !== undefined && badge > 0 && !item.comingSoon && (
          <span
            className="tnum"
            style={{
              fontSize: "var(--text-sm)",
              color: active ? "var(--fg-default)" : "var(--fg-subtle)",
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
        margin: "8px 2px 0",
        padding: "7px 10px",
        borderRadius: "var(--radius-sm)",
        border: "var(--border-w) solid var(--border)",
        background: "var(--bg-sunken)",
        color: "var(--ink-soft)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1.3,
        cursor: "default",
        userSelect: "none",
      }}
    >
      <Lock
        size={12}
        strokeWidth={2.4}
        style={{ flexShrink: 0, color: "var(--violet-500)" }}
      />
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
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
        padding: 4,
        zIndex: 20,
        animation: "cd-menu-in var(--dur-base) var(--ease)",
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
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          background: "var(--violet-500)",
          color: "var(--on-violet)",
          border: "var(--border-w) solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-sans)",
          fontWeight: "var(--weight-bold)",
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
            color: "var(--fg-default)",
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
