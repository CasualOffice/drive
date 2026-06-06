/**
 * Right-click + kebab context menu shared by every file/folder card and row.
 *
 * Two surfaces, one menu:
 *   - <EntryContextMenu /> wraps a target to enable right-click.
 *   - <EntryKebab />       renders a button that opens the same items.
 *
 * Wired in v0:                 Open, Preview, Rename, Download, See details,
 *                              Move to trash.
 * Stubbed (toast "Coming…"):   Share, Move, Make a copy, Activity.
 *
 * Folders get a trimmed menu (no Preview / Download / Details / Share).
 */
import {
  Activity,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FolderInput,
  Info,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import { toast } from "sonner";

import type { FileDto, FolderDto } from "../api/client.ts";

export type Entry = { kind: "folder"; folder: FolderDto } | { kind: "file"; file: FileDto };

export interface EntryMenuHandlers {
  onOpen: () => void;
  onPreview?: () => void;
  onRename: () => void;
  onTrash: () => void;
  onDownload?: () => void;
  onDetails?: () => void;
  onShare?: () => void;
}

interface ItemDef {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  shortcut?: string;
}

interface Group {
  items: ItemDef[];
}

function buildGroups(entry: Entry, h: EntryMenuHandlers): Group[] {
  const isFile = entry.kind === "file";
  const stub = (label: string) =>
    toast.info(`${label} is coming in v0.2.`, { description: "Wired backend lands alongside the section's API." });

  const primary: ItemDef[] = [
    { label: "Open", icon: <ExternalLink size={14} strokeWidth={1.8} />, onSelect: h.onOpen, shortcut: "↵" },
  ];
  if (isFile) {
    primary.push({
      label: "Preview",
      icon: <Eye size={14} strokeWidth={1.8} />,
      onSelect: h.onPreview ?? (() => {}),
      shortcut: "Space",
    });
  }

  const collab: ItemDef[] = [
    {
      label: "Share…",
      icon: <Share2 size={14} strokeWidth={1.8} />,
      onSelect: h.onShare ?? (() => stub("Sharing")),
    },
    { label: "Move…", icon: <FolderInput size={14} strokeWidth={1.8} />, onSelect: () => stub("Move") },
    { label: "Make a copy", icon: <Copy size={14} strokeWidth={1.8} />, onSelect: () => stub("Make a copy") },
    { label: "Rename", icon: <Pencil size={14} strokeWidth={1.8} />, onSelect: h.onRename, shortcut: "F2" },
  ];

  const meta: ItemDef[] = [];
  if (isFile) {
    meta.push({
      label: "Download",
      icon: <Download size={14} strokeWidth={1.8} />,
      onSelect: h.onDownload ?? (() => {}),
    });
    meta.push({
      label: "See details",
      icon: <Info size={14} strokeWidth={1.8} />,
      onSelect: h.onDetails ?? (() => {}),
    });
  }
  meta.push({ label: "Activity", icon: <Activity size={14} strokeWidth={1.8} />, onSelect: () => stub("Activity") });

  const destructive: ItemDef[] = [
    {
      label: "Move to trash",
      icon: <Trash2 size={14} strokeWidth={1.8} />,
      onSelect: h.onTrash,
      danger: true,
      shortcut: "⌫",
    },
  ];

  return [{ items: primary }, { items: collab }, { items: meta }, { items: destructive }];
}

// ── Right-click ────────────────────────────────────────────────────────

export function EntryContextMenu({
  entry,
  handlers,
  children,
}: {
  entry: Entry;
  handlers: EntryMenuHandlers;
  children: React.ReactNode;
}) {
  const groups = buildGroups(entry, handlers);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content style={menuStyle()}>{renderGroups(groups, "ctx")}</ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ── Kebab dropdown ─────────────────────────────────────────────────────

export function EntryKebab({
  entry,
  handlers,
  className,
}: {
  entry: Entry;
  handlers: EntryMenuHandlers;
  className?: string;
}) {
  const groups = buildGroups(entry, handlers);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="More actions"
          className={className}
          onClick={(e) => e.stopPropagation()}
          style={kebabStyle()}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.borderColor = "var(--line-strong)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "rgba(251,250,246,.92)";
            e.currentTarget.style.borderColor = "var(--line)";
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} style={menuStyle()}>
          {renderGroups(groups, "dd")}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ── Render ──────────────────────────────────────────────────────────────

function renderGroups(groups: Group[], variant: "ctx" | "dd") {
  return groups.map((g, gi) => (
    <div key={gi}>
      {gi > 0 && <Separator variant={variant} />}
      {g.items.map((item, ii) => (
        <MenuItem key={`${gi}-${ii}`} item={item} variant={variant} />
      ))}
    </div>
  ));
}

function MenuItem({ item, variant }: { item: ItemDef; variant: "ctx" | "dd" }) {
  const Item = variant === "ctx" ? ContextMenu.Item : DropdownMenu.Item;
  return (
    <Item
      onSelect={(e) => {
        e.preventDefault();
        item.onSelect();
      }}
      style={itemStyle(!!item.danger)}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = item.danger ? "rgba(176, 69, 69, .08)" : "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ color: item.danger ? "var(--danger)" : "var(--muted)", display: "inline-flex" }}>
        {item.icon}
      </span>
      <span style={{ flex: 1, color: item.danger ? "var(--danger)" : "var(--ink)" }}>{item.label}</span>
      {item.shortcut && (
        <span
          style={{
            fontSize: 11,
            color: "var(--muted-2)",
            fontVariantNumeric: "tabular-nums",
            paddingLeft: 16,
          }}
        >
          {item.shortcut}
        </span>
      )}
    </Item>
  );
}

function Separator({ variant }: { variant: "ctx" | "dd" }) {
  const Sep = variant === "ctx" ? ContextMenu.Separator : DropdownMenu.Separator;
  return <Sep style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />;
}

// ── Styles ──────────────────────────────────────────────────────────────

function menuStyle(): React.CSSProperties {
  return {
    minWidth: 220,
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 12,
    boxShadow: "var(--shadow-hover)",
    padding: 6,
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--ink)",
    zIndex: 60,
    animation: "cd-menu-in 180ms var(--ease)",
  };
}

function itemStyle(danger: boolean): React.CSSProperties {
  void danger;
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    cursor: "pointer",
    userSelect: "none",
    outline: "none",
    transition: "background 120ms",
  };
}

function kebabStyle(): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    border: "1px solid var(--line)",
    borderRadius: 7,
    background: "rgba(251,250,246,.92)",
    color: "var(--ink)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    transition: "background 150ms, border-color 150ms",
  };
}
