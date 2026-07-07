import {
  File as FileGeneric,
  FileSpreadsheet,
  FileText,
  Folder,
  Lock,
} from "lucide-react";

import type { FileDto, FolderDto } from "../api/client.ts";
import { StatusChip } from "./ds/StatusChip.tsx";
import { VAULT_GRID } from "./ds/SkeletonRow.tsx";

function fileIcon(name: string, contentType: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const ct = contentType ?? "";
  if (ext === "xlsx" || ext === "xlsm" || ext === "csv" || ct.includes("spreadsheet")) {
    return FileSpreadsheet;
  }
  if (ext === "docx" || ext === "pdf" || ext === "md" || ext === "txt" || ct.includes("wordprocessingml")) {
    return FileText;
  }
  return FileGeneric;
}

/** Documents-only kind label — no Video/Audio/Archive (ingest allowlist). */
function kindLabel(name: string, contentType: string | null): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "docx":
      return "Document";
    case "xlsx":
    case "xlsm":
      return "Spreadsheet";
    case "pptx":
      return "Slides";
    case "pdf":
      return "PDF";
    case "md":
      return "Markdown";
    case "csv":
      return "CSV";
    case "json":
      return "JSON";
    case "yaml":
    case "yml":
      return "YAML";
    case "txt":
      return "Text";
    default:
      if (contentType?.startsWith("text/")) return "Text";
      return ext.toUpperCase() || "Document";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} hrs ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function FolderRow({
  folder,
  onOpen,
}: {
  folder: FolderDto;
  onOpen: (id: string) => void;
}) {
  return (
    <Row
      icon={<Folder size={16} strokeWidth={1.5} style={{ color: "var(--fg-muted)" }} />}
      name={folder.name}
      modified={folder.modified_at}
      version={null}
      kind="Folder"
      encrypted={false}
      onOpen={() => onOpen(folder.id)}
    />
  );
}

export function FileRowComponent({
  file,
  onDownload,
}: {
  file: FileDto;
  onDownload: (id: string) => void;
}) {
  const Icon = fileIcon(file.name, file.content_type);
  return (
    <Row
      icon={<Icon size={16} strokeWidth={1.5} style={{ color: "var(--fg-muted)" }} />}
      name={file.name}
      modified={file.modified_at}
      version={file.version}
      kind={kindLabel(file.name, file.content_type)}
      encrypted
      onOpen={() => onDownload(file.id)}
    />
  );
}

function Row({
  icon,
  name,
  modified,
  version,
  kind,
  encrypted,
  onOpen,
}: {
  icon: React.ReactNode;
  name: string;
  modified: string;
  version: number | null;
  kind: string;
  encrypted: boolean;
  onOpen: () => void;
}) {
  const cell: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  return (
    <div
      onDoubleClick={onOpen}
      className="cd-row"
      style={{
        display: "grid",
        gridTemplateColumns: VAULT_GRID,
        alignItems: "center",
        height: 32,
        padding: "0 var(--space-3)",
        gap: "var(--space-3)",
        cursor: "default",
        userSelect: "none",
        fontSize: "var(--text-base)",
        color: "var(--fg-default)",
        borderBottom: "1px solid var(--border-hair)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <span aria-hidden />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        {icon}
        <span style={{ ...cell, fontWeight: "var(--weight-medium)" }}>{name}</span>
      </div>
      <span style={{ ...cell, color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>{kind}</span>
      <span className="mono" style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
        {version === null ? "—" : `v${version}`}
      </span>
      <span style={{ ...cell, color: "var(--fg-muted)", fontSize: "var(--text-xs)" }}>
        {formatRelative(modified)}
      </span>
      <span style={{ display: "flex", alignItems: "center" }}>
        {encrypted ? (
          <span
            title="Encrypted at rest"
            aria-label="Encrypted at rest"
            style={{ display: "inline-flex", color: "var(--fg-subtle)" }}
          >
            <Lock size={13} strokeWidth={1.5} />
          </span>
        ) : (
          <span style={{ color: "var(--fg-subtle)", fontSize: "var(--text-sm)" }}>—</span>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
        {encrypted ? (
          <StatusChip
            icon={<Lock size={11} strokeWidth={1.5} />}
            label="AES-256-GCM"
            tone="ambient"
            title="Encrypted at rest with AES-256-GCM"
          />
        ) : (
          <span style={{ color: "var(--fg-subtle)", fontSize: "var(--text-2xs)" }}>—</span>
        )}
      </span>
      <span aria-hidden />
      <style>
        {`
          .cd-row:hover { background: var(--bg-hover); }
        `}
      </style>
    </div>
  );
}
