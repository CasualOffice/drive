import { FileText, Folder, Image as ImageIcon, FileSpreadsheet, File as FileGeneric } from "lucide-react";

import type { FileDto, FolderDto } from "../api/client.ts";

function fileIcon(name: string, contentType: string | null) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const ct = contentType ?? "";
  if (ct.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return ImageIcon;
  }
  if (ext === "xlsx" || ext === "ods" || ext === "csv" || ct.includes("spreadsheet")) {
    return FileSpreadsheet;
  }
  if (ext === "docx" || ct.includes("wordprocessingml")) {
    return FileText;
  }
  return FileGeneric;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} hrs ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)} days ago`;
  // Defer to system / preferred timezone via Intl. We honour the user's
  // timezone preference here when settings land (see project memory).
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
      icon={<Folder size={16} strokeWidth={2} style={{ color: "var(--fg-muted)" }} />}
      name={folder.name}
      modified={folder.modified_at}
      size={null}
      kind="Folder"
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
      icon={<Icon size={16} strokeWidth={2} style={{ color: "var(--fg-muted)" }} />}
      name={file.name}
      modified={file.modified_at}
      size={file.size}
      kind={kindLabel(file.name, file.content_type)}
      onOpen={() => onDownload(file.id)}
    />
  );
}

function kindLabel(name: string, contentType: string | null): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx") return "Spreadsheet";
  if (ext === "docx") return "Document";
  if (ext === "pdf") return "PDF";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "Image";
  if (ext === "svg") return "SVG";
  if (ext === "mp4" || ext === "mov") return "Video";
  if (ext === "mp3" || ext === "wav") return "Audio";
  if (ext === "zip" || ext === "tar" || ext === "gz") return "Archive";
  if (contentType?.startsWith("text/")) return "Text";
  return ext.toUpperCase() || "File";
}

function Row({
  icon,
  name,
  modified,
  size,
  kind,
  onOpen,
}: {
  icon: React.ReactNode;
  name: string;
  modified: string;
  size: number | null;
  kind: string;
  onOpen: () => void;
}) {
  return (
    <div
      onDoubleClick={onOpen}
      className="cd-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 160px 96px 120px",
        alignItems: "center",
        height: "32px",
        padding: "0 var(--space-4)",
        borderRadius: "var(--radius-xs)",
        cursor: "default",
        userSelect: "none",
        fontSize: "var(--text-sm)",
        color: "var(--fg-default)",
        gap: "var(--space-3)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          minWidth: 0,
        }}
      >
        {icon}
        <span
          style={{
            fontWeight: "var(--weight-medium)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </div>
      <span style={{ color: "var(--fg-muted)" }}>{formatRelative(modified)}</span>
      <span
        className="tabular-nums"
        style={{ color: "var(--fg-muted)", textAlign: "right" }}
      >
        {size === null ? "—" : formatSize(size)}
      </span>
      <span style={{ color: "var(--fg-muted)" }}>{kind}</span>
      <style>
        {`
          .cd-row:hover { background: var(--bg-hover); }
        `}
      </style>
    </div>
  );
}
