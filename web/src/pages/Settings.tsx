/**
 * Settings surface — two-column shell (section nav + content pane).
 *
 * Spec: docs/ux/03-settings-surface.md + docs/design/ui-system.md (§7.1
 * sidebar: 28px items, --bg-selected + 2px left amber rule + bold label on
 * active). Account / Storage / About / Members / Encryption ship real; the
 * rest are polished ComingSoon panels. Logic + section list intact.
 */
import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  Key,
  KeyRound,
  Monitor,
  Share2,
  ShieldCheck,
  Users,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { ComingSoon } from "../components/ComingSoon.tsx";
import { useIsMobile } from "../lib/useMediaQuery.ts";
import { AccountSection } from "./settings/AccountSection.tsx";
import { DisplaySection } from "./settings/DisplaySection.tsx";
import { EncryptionSection } from "./settings/EncryptionSection.tsx";
import { MembersSection } from "./settings/MembersSection.tsx";
import { TokensSection } from "./settings/TokensSection.tsx";

type GroupId = "personal" | "workspace" | "compliance";

type SectionId =
  | "account"
  | "display"
  | "notifications"
  | "tokens"
  | "members"
  | "roles"
  | "sharing"
  | "encryption";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  group: GroupId;
}

// M6 relayout: 12 → 8 sections in three groups. About / Storage moved to
// Admin › System; Retention moved to Admin › Retention & legal hold; the
// Audit-log stub is gone (the live feed lives on the Activity surface).
const SECTIONS: SectionDef[] = [
  { id: "account", label: "Account", icon: UserCircle, group: "personal" },
  { id: "display", label: "Display", icon: Monitor, group: "personal" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "personal" },
  { id: "tokens", label: "Tokens & sessions", icon: Key, group: "personal" },
  { id: "members", label: "Members", icon: Users, group: "workspace" },
  { id: "roles", label: "Roles & permissions", icon: ShieldCheck, group: "workspace" },
  { id: "sharing", label: "Sharing", icon: Share2, group: "workspace" },
  { id: "encryption", label: "Encryption & keys", icon: KeyRound, group: "compliance" },
];

const GROUPS: { id: GroupId; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "workspace", label: "Workspace" },
  { id: "compliance", label: "Compliance" },
];

export function Settings() {
  const [current, setCurrent] = useState<SectionId>("account");
  const currentDef = SECTIONS.find((s) => s.id === current)!;
  const isMobile = useIsMobile();
  // On phones the two-pane shell collapses to a single column: the section
  // list is the master view; picking one pushes the detail pane with a
  // back affordance (a Settings-app / iOS pattern).
  const [mobilePane, setMobilePane] = useState<"nav" | "detail">("nav");

  if (isMobile) {
    if (mobilePane === "nav") {
      return (
        <div style={{ flex: 1, background: "var(--bg-canvas)", minHeight: 0, overflowY: "auto" }}>
          <SectionNav
            current={current}
            fullWidth
            onSelect={(id) => {
              setCurrent(id);
              setMobilePane("detail");
            }}
          />
        </div>
      );
    }
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-canvas)", minHeight: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            height: 52,
            flexShrink: 0,
            padding: "0 var(--space-3)",
            background: "var(--bg-surface)",
            borderBottom: "var(--border-w) solid var(--border)",
          }}
        >
          <button
            type="button"
            onClick={() => setMobilePane("nav")}
            aria-label="Back to settings"
            data-testid="settings-back"
            className="press-sink"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "var(--border-w) solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-surface)",
              color: "var(--fg-default)",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={18} strokeWidth={2.2} />
          </button>
          <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--fg-default)" }}>
            {currentDef.label}
          </span>
        </header>
        <ContentPane>{renderSection(currentDef)}</ContentPane>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        background: "var(--bg-canvas)",
        minHeight: 0,
      }}
    >
      <SectionNav current={current} onSelect={setCurrent} />
      <ContentPane>{renderSection(currentDef)}</ContentPane>
    </div>
  );
}

function SectionNav({
  current,
  onSelect,
  fullWidth,
}: {
  current: SectionId;
  onSelect: (id: SectionId) => void;
  /** Mobile master view — drop the right border + fill the column. */
  fullWidth?: boolean;
}) {
  return (
    <nav
      aria-label="Settings sections"
      style={{
        borderRight: fullWidth ? "none" : "var(--border-w) solid var(--border)",
        background: "var(--bg-surface)",
        padding: "var(--space-6) var(--space-3) var(--space-4)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <h1
        style={{
          margin: "0 var(--space-2) var(--space-4)",
          fontSize: "var(--text-2xl)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--fg-default)",
        }}
      >
        Settings
      </h1>

      {GROUPS.map((g, gi) => {
        const items = SECTIONS.filter((s) => s.group === g.id);
        if (items.length === 0) return null;
        return (
          <div key={g.id} style={{ marginTop: gi === 0 ? 0 : "var(--space-4)" }}>
            <span className="caps-label" style={{ display: "block", padding: "0 var(--space-2) var(--space-1)" }}>
              {g.label}
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              {items.map((s) => (
                <li key={s.id}>
                  <NavItem def={s} active={current === s.id} onClick={() => onSelect(s.id)} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function NavItem({
  def,
  active,
  onClick,
}: {
  def: SectionDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        height: 32,
        padding: "0 var(--space-2) 0 var(--space-3)",
        borderRadius: "var(--radius-sm)",
        border: `var(--border-w) solid ${active ? "var(--border)" : "transparent"}`,
        background: active ? "var(--violet-100)" : "transparent",
        color: active ? "var(--ink)" : "var(--fg-muted)",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-md)",
        fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
        textAlign: "left",
        transition: "background var(--dur-instant) var(--ease), color var(--dur-instant) var(--ease)",
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
      <Icon size={16} strokeWidth={active ? 2.4 : 2} aria-hidden style={{ flexShrink: 0, color: active ? "var(--violet-500)" : "var(--fg-subtle)" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.label}</span>
    </button>
  );
}

function ContentPane({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ overflowY: "auto", padding: "var(--space-6)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function renderSection(def: SectionDef): React.ReactNode {
  switch (def.id) {
    case "account":
      return <AccountSection />;
    case "display":
      return <DisplaySection />;
    case "encryption":
      return <EncryptionSection />;
    case "members":
      return <MembersSection />;
    case "roles":
      return (
        <ComingSoon
          title="Roles & permissions"
          description="Define custom roles and the per-permission grid that backs them — beyond the four defaults."
          bullets={[
            "Built-in: Owner, Admin, Editor, Viewer",
            "Per-resource grants: document / folder / workspace",
            "Per-action grants: read / write / share / delete",
          ]}
        />
      );
    case "sharing":
      return (
        <ComingSoon
          title="Sharing defaults"
          description="Control the default expiry, default permission level, and password requirement for every new share link."
          bullets={[
            "Default expiry: 7 days / 30 days / never",
            "Default permission: view / comment / edit",
            "Require a password on every new link",
          ]}
        />
      );
    case "notifications":
      return (
        <ComingSoon
          title="Notifications"
          description="Decide what events Doc-Hub emails you about — and how often."
          bullets={[
            "Per-event toggle (share / mention / activity / system)",
            "Daily or weekly digest cadence",
            "Per-channel routing (email / webhook)",
          ]}
        />
      );
    case "tokens":
      return <TokensSection />;
  }
}
