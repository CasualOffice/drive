/**
 * File preview modal — Radix Dialog backed. Two-column layout (preview stage
 * + detail sidebar). Type-aware primary action (Open in Sheets / Editor /
 * Download). Keyboard: Esc closes, ←/→ navigates.
 *
 * v0 doesn't render inline previews for binary types — the stage shows the
 * file's procedural thumbnail at large size. Phase-2 wires real PDF.js /
 * image / video / text rendering.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
  Share2,
  Star,
  X,
} from "lucide-react";

import type { UseFileSourceAutoSaveReturn } from "@schnsrw/docx-js-editor";

import { downloadUrl, type FileDto } from "../api/client.ts";
import { useReportViewing } from "../state/PresenceContext.tsx";
import { DetailsPanel } from "./DetailsPanel.tsx";
import { FileThumb, inferKind } from "./FileThumb.tsx";
import { PreviewStage } from "./preview/PreviewStage.tsx";
import { ShareDialog } from "./ShareDialog.tsx";

// AutosaveStatus is lazy — the SDK's vendor bundle (which contains a
// React.Activity assignment that crashes module-init on React 19) must
// never load at app boot. Suspense fallback is null because the dot
// is decorative chrome only shown when a .docx is open.
const AutosaveStatus = lazy(() =>
  import("@schnsrw/docx-js-editor").then((m) => ({ default: m.AutosaveStatus })),
);

export function PreviewModal({
  files,
  index,
  open,
  onClose,
  onChangeIndex,
}: {
  files: FileDto[];
  index: number;
  open: boolean;
  onClose: () => void;
  onChangeIndex: (i: number) => void;
}) {
  const file = files[index];
  const hasNav = files.length > 1;

  /** Navigate to `/document/<id>/edit` for the in-Drive fullscreen
   *  editor (P2.1 canonical surface; `/file/<id>` still resolves as an
   *  alias). Pushes the FileDto into `history.state` so FileFullscreen
   *  can mount without an extra metadata round trip. Closes the modal
   *  first so the back-stack reads cleanly. */
  const openInFullscreen = (target: FileDto) => {
    onClose();
    const url = `/document/${encodeURIComponent(target.id)}/edit`;
    window.history.pushState({ file: target }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  // Autosave state bubbled up from CasualDocEditor when a .docx is in
  // view. Stays null for every other stage; the indicator collapses to
  // nothing in that case (AutosaveStatus already renders null on the
  // idle/never-saved state).
  const [autosaveState, setAutosaveState] = useState<UseFileSourceAutoSaveReturn | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Reset when the focused file changes — peer files might not be docs,
  // and stale state from the previous file would lie to the user.
  useEffect(() => {
    setAutosaveState(null);
  }, [files[index]?.id]);

  // RT3 — announce the focused file to peers' presence streams so
  // their file rows light up with the viewing dot. Pin updates on
  // ←/→ navigation between peer files; clears when the modal closes.
  const reportViewing = useReportViewing();
  const focusedId = open ? (files[index]?.id ?? null) : null;
  useEffect(() => {
    reportViewing(focusedId);
    return () => {
      if (focusedId) reportViewing(null);
    };
  }, [focusedId, reportViewing]);

  // ←/→ keyboard nav while open
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && hasNav) {
        onChangeIndex((index - 1 + files.length) % files.length);
      } else if (e.key === "ArrowRight" && hasNav) {
        onChangeIndex((index + 1) % files.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hasNav, index, files.length, onChangeIndex]);

  if (!file) return null;

  const kind = inferKind(file.name, file.content_type);
  const typeLabel = labelForKind(kind);
  const primary = primaryAction(kind, file, openInFullscreen);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--bg-overlay)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-fade-in 280ms var(--ease)",
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(1000px, calc(100% - 60px))",
            height: "min(640px, 90vh)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-hair)",
            borderRadius: "var(--radius-xl)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            boxShadow: "var(--shadow-lg)",
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-modal-in 320ms var(--ease)",
          }}
        >
          <Dialog.Title style={{ position: "absolute", left: -9999 }}>{file.name}</Dialog.Title>

          {/* Stage */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              background: "var(--bg-canvas)",
              borderRight: "1px solid var(--border-hair)",
            }}
          >
            <PreviewStage file={file} kind={kind} onAutosaveState={setAutosaveState} />

            {autosaveState && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  right: 12,
                  zIndex: 2,
                  fontSize: "var(--text-xs)",
                  color: "var(--fg-muted)",
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-hair)",
                  padding: "3px 9px",
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-sm)",
                  pointerEvents: "none",
                }}
              >
                <Suspense fallback={null}>
                  <AutosaveStatus state={autosaveState} />
                </Suspense>
              </div>
            )}

            {hasNav && (
              <>
                <NavArrow
                  side="prev"
                  onClick={() => onChangeIndex((index - 1 + files.length) % files.length)}
                />
                <NavArrow side="next" onClick={() => onChangeIndex((index + 1) % files.length)} />
              </>
            )}
          </div>

          {/* Side */}
          <aside
            style={{
              padding: "16px 20px 18px",
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
            }}
          >
            <div style={{ alignSelf: "flex-end", display: "flex", gap: 2, alignItems: "center" }}>
              <IconButton
                aria-label="Download"
                title="Download"
                onClick={() => window.location.assign(downloadUrl(file.id))}
              >
                <Download size={16} strokeWidth={1.5} />
              </IconButton>
              <IconButton
                aria-label="Expand to fullscreen"
                title="Open in full view"
                data-testid="preview-expand"
                onClick={() => openInFullscreen(file)}
              >
                <Maximize2 size={16} strokeWidth={1.5} />
              </IconButton>
              <Dialog.Close asChild>
                <IconButton aria-label="Close" title="Close (Esc)">
                  <X size={16} strokeWidth={1.5} />
                </IconButton>
              </Dialog.Close>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 6px" }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  flexShrink: 0,
                  border: "1px solid var(--border-hair)",
                }}
              >
                <FileThumb name={file.name} kind={kind} size="small" thumbnail={file.thumbnail} />
              </span>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-semibold)",
                  letterSpacing: "var(--tracking-tight)",
                  wordBreak: "break-word",
                  color: "var(--fg-default)",
                  margin: 0,
                }}
              >
                {file.name}
              </h3>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: "var(--text-xs)",
                color: "var(--fg-muted)",
                marginBottom: 18,
              }}
            >
              <span>{typeLabel}</span>
              {file.version > 0 && <VersionChip version={file.version} />}
              {file.size > 0 && <span>· {formatBytes(file.size)}</span>}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <ActionButton primary onClick={primary.onClick}>
                <primary.Icon size={15} strokeWidth={1.5} />
                {primary.label}
              </ActionButton>
              <ActionButton onClick={() => setShareOpen(true)}>
                <Share2 size={15} strokeWidth={1.5} />
                Share
              </ActionButton>
              <ActionButton icon aria-label="Star" onClick={() => {}}>
                <Star size={15} strokeWidth={1.5} />
              </ActionButton>
            </div>

            {/* Real tabbed Details panel — Info / People / History.
                Replaces the prior 4-row Details stub. */}
            <div style={{ flex: 1, minHeight: 0, marginTop: 4, marginLeft: -20, marginRight: -20 }}>
              <DetailsPanel file={file} onCreateShare={() => setShareOpen(true)} />
            </div>
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
      <ShareDialog open={shareOpen} file={file} onClose={() => setShareOpen(false)} />

      <style>
        {`
          @keyframes cd-fade-in   { from { opacity: 0; } to { opacity: 1; } }
          @keyframes cd-modal-in {
            from { opacity: 0; transform: translate(-50%, calc(-50% + 14px)) scale(.98); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
        `}
      </style>
    </Dialog.Root>
  );
}

/** 28×28 ghost icon button (ui-system §7.9). Hover → --bg-hover; the
 *  global :focus-visible ring supplies keyboard focus. */
function IconButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      style={{
        width: 28,
        height: 28,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: "var(--fg-muted)",
        borderRadius: "var(--radius-sm)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background var(--dur-instant) var(--ease-out)",
      }}
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

/** `v12` version chip — mono, tabular, muted (ui-system §7.2). */
function VersionChip({ version }: { version: number }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 16,
        padding: "0 5px",
        fontSize: "var(--text-2xs)",
        color: "var(--fg-muted)",
        background: "var(--bg-sunken)",
        border: "1px solid var(--border-hair)",
        borderRadius: "var(--radius-xs)",
      }}
    >
      v{version}
    </span>
  );
}

function NavArrow({ side, onClick }: { side: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "prev" ? "Previous file" : "Next file"}
      onClick={onClick}
      style={
        {
          position: "absolute",
          top: "50%",
          transform: "translateY(-50%)",
          [side === "prev" ? "left" : "right"]: 16,
          width: 32,
          height: 32,
          borderRadius: "var(--radius-pill)",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "var(--fg-default)",
          boxShadow: "var(--shadow-sm)",
          transition: "background var(--dur-instant) var(--ease-out)",
        } as React.CSSProperties
      }
      onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseOut={(e) => (e.currentTarget.style.background = "var(--bg-raised)")}
    >
      {side === "prev" ? (
        <ChevronLeft size={16} strokeWidth={1.5} />
      ) : (
        <ChevronRight size={16} strokeWidth={1.5} />
      )}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
  icon,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  icon?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        flex: icon ? "0 0 34px" : primary ? 1.4 : 1,
        height: 34,
        border: `1px solid ${primary ? "var(--fg-default)" : "var(--border-strong)"}`,
        background: primary ? "var(--fg-default)" : "var(--bg-raised)",
        color: primary ? "var(--bg-surface)" : "var(--fg-default)",
        cursor: "pointer",
        padding: "0 12px",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-medium)",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
      onMouseOver={(e) => {
        if (primary) e.currentTarget.style.opacity = "0.88";
        else e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseOut={(e) => {
        if (primary) e.currentTarget.style.opacity = "1";
        else e.currentTarget.style.background = "var(--bg-raised)";
      }}
    >
      {children}
    </button>
  );
}

function primaryAction(
  kind: ReturnType<typeof inferKind>,
  file: FileDto,
  openInFullscreen: (file: FileDto) => void,
) {
  switch (kind) {
    case "sheet":
      // ED1 gap (a) — primary "open" now lands on Drive's in-app
      // `/file/<id>` route with the full Casual Sheets chrome
      // (toolbar / header / footer). The previous WOPI new-tab
      // handoff (`handoffToEditor`) survives as a fallback when an
      // operator wants the third-party path — kept in this file
      // for that wiring; not surfaced by default.
      return {
        label: "Open in editor",
        Icon: ExternalLink,
        onClick: () => openInFullscreen(file),
      };
    case "doc":
      return {
        label: "Open in editor",
        Icon: ExternalLink,
        onClick: () => openInFullscreen(file),
      };
    default:
      return {
        label: "Download",
        Icon: Download,
        onClick: () => window.location.assign(downloadUrl(file.id)),
      };
  }
}

// `handoffToEditor` (WOPI new-tab path via `openInEditor`) used to be
// the primary action for `.docx` / `.xlsx`. Replaced by the in-Drive
// fullscreen route in ED1 gap (a) — `openInFullscreen` above. The
// WOPI path stays in `crates/drive-wopi` for third-party / cross-
// origin clients; Drive's own SPA no longer reaches for it.

function labelForKind(k: ReturnType<typeof inferKind>): string {
  switch (k) {
    case "fold":
      return "Folder";
    case "doc":
      return "Document";
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
    case "md":
      return "Markdown";
    case "text":
      return "Text";
    default:
      return "File";
  }
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
