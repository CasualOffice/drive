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
  Activity,
  Bell,
  Building2,
  Database,
  Gavel,
  Info,
  Key,
  KeyRound,
  Share2,
  ShieldCheck,
  Users,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

import { ComingSoon } from "../components/ComingSoon.tsx";
import { AccountSection } from "./settings/AccountSection.tsx";
import { AboutSection } from "./settings/AboutSection.tsx";
import { EncryptionSection } from "./settings/EncryptionSection.tsx";
import { MembersSection } from "./settings/MembersSection.tsx";
import { StorageSection } from "./settings/StorageSection.tsx";

type GroupId = "you" | "team" | "security" | "system";

type SectionId =
  | "account"
  | "workspace"
  | "members"
  | "roles"
  | "sharing"
  | "encryption"
  | "retention"
  | "storage"
  | "notifications"
  | "tokens"
  | "audit"
  | "about";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  group: GroupId;
}

const SECTIONS: SectionDef[] = [
  { id: "account", label: "Account", icon: UserCircle, group: "you" },
  { id: "workspace", label: "Workspace", icon: Building2, group: "team" },
  { id: "members", label: "Members", icon: Users, group: "team" },
  { id: "roles", label: "Roles & permissions", icon: ShieldCheck, group: "team" },
  { id: "sharing", label: "Sharing", icon: Share2, group: "team" },
  { id: "encryption", label: "Encryption & keys", icon: KeyRound, group: "security" },
  { id: "retention", label: "Retention & holds", icon: Gavel, group: "security" },
  { id: "storage", label: "Storage", icon: Database, group: "system" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "system" },
  { id: "tokens", label: "API tokens", icon: Key, group: "system" },
  { id: "audit", label: "Audit log", icon: Activity, group: "system" },
  { id: "about", label: "About", icon: Info, group: "system" },
];

const GROUPS: { id: GroupId; label: string }[] = [
  { id: "you", label: "You" },
  { id: "team", label: "Workspace" },
  { id: "security", label: "Security" },
  { id: "system", label: "System" },
];

export function Settings() {
  const [current, setCurrent] = useState<SectionId>("account");
  const currentDef = SECTIONS.find((s) => s.id === current)!;

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
}: {
  current: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      style={{
        borderRight: "1px solid var(--border-hair)",
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
          fontSize: "var(--text-xl)",
          fontWeight: "var(--weight-semibold)",
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
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        width: "100%",
        height: 28,
        padding: "0 var(--space-2)",
        borderRadius: "var(--radius-sm)",
        borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        background: active ? "var(--bg-selected)" : "transparent",
        color: active ? "var(--fg-default)" : "var(--fg-muted)",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-md)",
        fontWeight: active ? "var(--weight-semibold)" : "var(--weight-body)",
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
      <Icon size={16} strokeWidth={1.5} aria-hidden style={{ flexShrink: 0, color: active ? "var(--fg-default)" : "var(--fg-subtle)" }} />
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
    case "encryption":
      return <EncryptionSection />;
    case "storage":
      return <StorageSection />;
    case "about":
      return <AboutSection />;
    case "members":
      return <MembersSection />;
    case "workspace":
      return (
        <ComingSoon
          title="Workspace"
          description="Rename your workspace, change the icon, and set the default visibility for new documents."
          bullets={[
            "Workspace name + monogram avatar",
            "Default document visibility (private / link-restricted / org)",
            "Workspace deletion + transfer-of-ownership",
          ]}
        />
      );
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
    case "retention":
      return (
        <ComingSoon
          title="Retention & holds"
          description="Set how long a tombstoned document ages before it is purge-eligible, and place or release legal holds."
          bullets={[
            "Per-project retention window (30 / 90 / 365 days / never)",
            "Place a legal hold — blocks tombstone + purge until released",
            "Release a hold — audited, chained event",
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
      return (
        <ComingSoon
          title="API tokens"
          description="Issue personal API tokens for scripts, sync clients, and CI. Each token is scoped + revocable."
          bullets={[
            "Per-token scope (read / write / admin)",
            "Per-token expiry + last-used timestamp",
            "Audit log entry on every issue / revoke",
          ]}
        />
      );
    case "audit":
      return (
        <ComingSoon
          title="Audit log"
          description="The append-only, hash-chained event feed lives on the Activity surface. A signed export report lands here."
          bullets={[
            "Grouped by day, type-tagged, owner-filterable",
            "Append-only audit_log — hash-chained for compliance",
            "Signed, offline-verifiable JSONL / CSV / PDF export",
          ]}
        />
      );
  }
}
