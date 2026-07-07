/**
 * DetailsPanel — three-tab metadata + access + history surface that
 * lives both in the PreviewModal's right column and in the
 * FileFullscreen header's drawer (UX-EDITOR-8).
 *
 * Tabs:
 *
 *   Info — every field the FileDto carries (type, size, owner, created,
 *          modified, location path, content-type, version), shown as a
 *          clean two-column key/value list. Goes deeper than the old
 *          inline "Details" section that only had 4 rows.
 *
 *   People — share-links for this file (uses the existing listShares
 *            API). Per-link permissions + expiry + access count + last
 *            accessed. "Create share link" CTA lifts to ShareDialog.
 *
 *   History — version history. The backend versions API isn't shipped
 *             yet (PIPELINE.md tracks this); the tab renders a friendly
 *             "Coming soon" card with what users can expect. Replaces
 *             outright until the API lands.
 *
 * Used in two places:
 *   - <PreviewModal> — replaces the static "Details" section
 *   - <FileFullscreen> — opens via a Details pill in the header
 */
import { useEffect, useState } from "react";
import { Clock, Info, Link as LinkIcon, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import { listShares, type FileDto, type ShareDto } from "../api/client.ts";
import { inferKind } from "./FileThumb.tsx";
import { VersionHistory } from "./VersionHistory.tsx";

export interface DetailsPanelProps {
  file: FileDto;
  /** Called when the user clicks "Create share link" in the People
   *  tab — the host opens the existing ShareDialog. */
  onCreateShare?: () => void;
}

type Tab = "info" | "people" | "history";

const TABS: Array<{ id: Tab; label: string; Icon: typeof Info }> = [
  { id: "info", label: "Info", Icon: Info },
  { id: "people", label: "People", Icon: Users },
  { id: "history", label: "History", Icon: Clock },
];

export function DetailsPanel({ file, onCreateShare }: DetailsPanelProps) {
  const [active, setActive] = useState<Tab>("info");

  return (
    <section
      data-testid="details-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div
        role="tablist"
        aria-label="File details"
        style={{
          display: "flex",
          gap: 2,
          padding: "4px 6px 0",
          borderBottom: "1px solid var(--line)",
          flex: "0 0 auto",
        }}
      >
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            label={t.label}
            Icon={t.Icon}
            active={active === t.id}
            onClick={() => setActive(t.id)}
            testId={`details-tab-${t.id}`}
          />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: active === "history" ? "hidden" : "auto",
          padding: active === "history" ? "12px 16px" : "16px 22px",
        }}
      >
        {active === "info" && <InfoTab file={file} />}
        {active === "people" && <PeopleTab file={file} onCreateShare={onCreateShare} />}
        {active === "history" && (
          <VersionHistory fileId={file.id} fileName={file.name} variant="panel" />
        )}
      </div>
    </section>
  );
}

function TabButton({
  label,
  Icon,
  active,
  onClick,
  testId,
}: {
  label: string;
  Icon: typeof Info;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`${testId}-panel`}
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--accent, #1a73e8)" : "2px solid transparent",
        color: active ? "var(--text)" : "var(--muted)",
        fontSize: "var(--text-sm)",
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        position: "relative",
        top: 1, // align border with tab-strip's bottom line
      }}
    >
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </button>
  );
}

// ── Info ──────────────────────────────────────────────────────────────

function InfoTab({ file }: { file: FileDto }) {
  const kind = inferKind(file.name, file.content_type);
  const typeLabel = humanType(kind, file.content_type);
  const created = new Date(file.created_at);
  const modified = new Date(file.modified_at);
  return (
    <dl style={infoListStyle()} data-testid="details-tab-info-panel">
      <Row k="Type" v={typeLabel} />
      <Row k="Size" v={file.size > 0 ? formatBytes(file.size) : "—"} />
      <Row k="Owner" v="you" />
      <Row k="Location" v="My Drive" />
      <Row k="Created" v={formatDateTime(created)} />
      <Row k="Modified" v={formatDateTime(modified)} />
      <Row k="Version" v={String(file.version)} />
      {file.content_type && <Row k="Content type" v={file.content_type} mono />}
    </dl>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>{k}</dt>
      <dd
        style={{
          margin: 0,
          color: "var(--text)",
          fontSize: "var(--text-sm)",
          fontFamily: mono ? "var(--font-mono, ui-monospace, monospace)" : "inherit",
          wordBreak: "break-word",
        }}
      >
        {v}
      </dd>
    </>
  );
}

// ── People ────────────────────────────────────────────────────────────

function PeopleTab({ file, onCreateShare }: { file: FileDto; onCreateShare?: () => void }) {
  const [shares, setShares] = useState<ShareDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setShares(null);
    setError(null);
    void (async () => {
      try {
        const resp = await listShares(file.id);
        if (cancelled) return;
        setShares(resp.shares);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't load share links");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  if (error) {
    return (
      <p
        data-testid="details-tab-people-error"
        style={{ color: "var(--danger, #d63a2f)", fontSize: "var(--text-sm)" }}
      >
        {error}
      </p>
    );
  }

  if (shares === null) {
    return (
      <p
        data-testid="details-tab-people-loading"
        style={{ color: "var(--muted)", fontSize: "var(--text-sm)" }}
      >
        Loading…
      </p>
    );
  }

  return (
    <div data-testid="details-tab-people-panel">
      {shares.length === 0 && (
        <div style={emptyStateStyle()}>
          <Users size={20} style={{ color: "var(--muted)" }} />
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Only you have access</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
            Create a share link to give other people view access.
          </div>
        </div>
      )}
      {shares.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {shares.map((s) => (
            <ShareRow key={s.id} share={s} />
          ))}
        </ul>
      )}
      {onCreateShare && (
        <button
          type="button"
          onClick={onCreateShare}
          data-testid="details-people-create-share"
          style={primaryBtnStyle()}
        >
          <Plus size={14} />
          Create share link
        </button>
      )}
    </div>
  );
}

function ShareRow({ share }: { share: ShareDto }) {
  const expiresAt = share.expires_at ? new Date(share.expires_at) : null;
  const lastAccessed = share.last_accessed_at ? new Date(share.last_accessed_at) : null;
  return (
    <li
      data-testid={`details-share-row-${share.id}`}
      style={{
        padding: "12px 14px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(share.url);
          toast.success("Share link copied");
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--accent, #1a73e8)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          textAlign: "left",
        }}
      >
        <LinkIcon size={13} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 220,
          }}
        >
          {share.url}
        </span>
      </button>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
          fontSize: "var(--text-xs)",
          color: "var(--muted)",
        }}
      >
        <span>{share.permissions === "view" ? "View only" : share.permissions}</span>
        <span>
          · {share.access_count} {share.access_count === 1 ? "open" : "opens"}
        </span>
        {lastAccessed && <span>· last {formatRelative(Date.now() - lastAccessed.getTime())}</span>}
        {expiresAt && <span>· expires {formatDateTime(expiresAt)}</span>}
        {share.has_password && <span>· password</span>}
      </div>
    </li>
  );
}

// ── helpers ───────────────────────────────────────────────────────────

function humanType(kind: ReturnType<typeof inferKind>, contentType: string | null): string {
  switch (kind) {
    case "doc":
      return "Word document";
    case "sheet":
      return "Spreadsheet";
    case "pdf":
      return "PDF";
    case "img":
      return "Image";
    case "vid":
      return "Video";
    case "aud":
      return "Audio";
    case "text":
      return "Text";
    case "md":
      return "Markdown";
    case "fold":
      return "Folder";
    default:
      return contentType ?? "File";
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  return `${Math.round(abs / 86_400_000)}d ago`;
}

function infoListStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(80px, 110px) 1fr",
    rowGap: 10,
    columnGap: 16,
    margin: 0,
    padding: 0,
  };
}

function emptyStateStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "32px 16px",
    textAlign: "center",
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "var(--accent, #1a73e8)",
    color: "white",
    border: "none",
    borderRadius: 8,
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}
