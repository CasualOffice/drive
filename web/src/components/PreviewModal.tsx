/**
 * File preview modal — Radix Dialog backed. Single-column glass STAGE
 * (ui-redesign-v3 §3): the stage shows content, a one-line proof summary
 * (`Encrypted · v{n} · ✓ Verified`) sits under the title, and the full
 * compliance panel is opt-in behind a "Details" toggle. Type-aware primary
 * action (Open in Editor / Download). Keyboard: Esc closes, ←/→ navigates.
 *
 * On viewports < 800px the two-column-era modal breaks, so single-click
 * routes straight to the fullscreen editor (§3.1) — the modal never renders
 * a crippled version at that width.
 *
 * v0 doesn't render inline previews for binary types — the stage shows the
 * file's procedural thumbnail at large size. Phase-2 wires real PDF.js /
 * image / text rendering.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
  PanelRight,
  ShieldCheck,
} from "lucide-react";

import type { UseFileSourceAutoSaveReturn } from "@casualoffice/docs";

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
  import("@casualoffice/docs").then((m) => ({ default: m.AutosaveStatus })),
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
  // Kept in a ref so the <800px routing effect can fire on `open` alone
  // without re-running when the closure changes each render.
  const openInFullscreenRef = useRef(openInFullscreen);
  openInFullscreenRef.current = openInFullscreen;
  // Autosave state bubbled up from CasualDocEditor when a .docx is in
  // view. Stays null for every other stage; the indicator collapses to
  // nothing in that case (AutosaveStatus already renders null on the
  // idle/never-saved state).
  const [autosaveState, setAutosaveState] = useState<UseFileSourceAutoSaveReturn | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Details panel is opt-in (§3.2): the modal is preview + proof summary
  // by default; the full compliance panel discloses on demand.
  const [showDetails, setShowDetails] = useState(false);
  // Reset when the focused file changes — peer files might not be docs,
  // and stale state from the previous file would lie to the user.
  useEffect(() => {
    setAutosaveState(null);
    setShowDetails(false);
  }, [files[index]?.id]);

  // §3.1 — on narrow viewports the two-column-era stage breaks, so a
  // single-click opens the fullscreen editor directly instead of a
  // crippled modal. Fires only as the modal is asked to open.
  useEffect(() => {
    if (!open) return;
    const target = files[index];
    if (target && typeof window !== "undefined" && window.innerWidth < 800) {
      openInFullscreenRef.current(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-fade-in 280ms var(--ease)",
          }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="glass glass--overlay"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(1000px, calc(100% - 60px))",
            height: "min(640px, 90vh)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-modal-in 320ms var(--ease-spring)",
          }}
        >
          <Dialog.Title style={{ position: "absolute", left: -9999 }}>{file.name}</Dialog.Title>

          {/* Stage — single column, full width */}
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              background: "var(--bg-canvas)",
            }}
          >
            <PreviewStage file={file} kind={kind} onAutosaveState={setAutosaveState} />

            {/* Top-right stage chrome: Download + Expand. The redundant ×
                and no-op Star are gone (§3.2); Esc and scrim-click close. */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                zIndex: 3,
                display: "flex",
                gap: 2,
                alignItems: "center",
              }}
            >
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
            </div>

            {autosaveState && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: 12,
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

            {/* Opt-in Details drawer — reuses the single compliance card
                (§3.2). Slides over the stage's right edge on demand. */}
            {showDetails && (
              <aside
                className="glass glass--overlay"
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: "min(320px, 80%)",
                  zIndex: 4,
                  borderRadius: 0,
                  borderLeft: "1px solid var(--border-hair)",
                  overflowY: "auto",
                  animation: "cd-drawer-in 260ms var(--ease-spring)",
                }}
              >
                <DetailsPanel file={file} onCreateShare={() => setShareOpen(true)} />
              </aside>
            )}
          </div>

          {/* Footer — title + proof one-liner + primary action (§3.3) */}
          <footer
            className="glass"
            style={{
              flexShrink: 0,
              padding: "12px 20px 14px",
              borderTop: "1px solid var(--border-hair)",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
                flexShrink: 0,
                border: "1px solid var(--border-hair)",
              }}
            >
              <FileThumb name={file.name} kind={kind} size="small" thumbnail={file.thumbnail} />
            </span>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--text-base)",
                    fontWeight: "var(--weight-semibold)",
                    letterSpacing: "var(--tracking-tight)",
                    color: "var(--fg-default)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.name}
                </h3>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: "var(--text-xs)",
                    color: "var(--fg-muted)",
                  }}
                >
                  {typeLabel}
                  {file.size > 0 && ` · ${formatBytes(file.size)}`}
                </span>
              </div>
              {/* Proof one-liner — the three facts that matter for a
                  records tool, stated inline (§3.3). */}
              <ProofOneLiner version={file.version} />
            </div>

            <button
              type="button"
              aria-label="Toggle details"
              aria-pressed={showDetails}
              title="Details"
              data-testid="preview-details-toggle"
              onClick={() => setShowDetails((v) => !v)}
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 12px",
                border: `1px solid ${showDetails ? "var(--fg-default)" : "var(--border-strong)"}`,
                background: showDetails ? "var(--bg-hover)" : "var(--bg-raised)",
                color: "var(--fg-default)",
                cursor: "pointer",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
            >
              <PanelRight size={15} strokeWidth={1.5} />
              Details
            </button>

            <div style={{ flexShrink: 0 }}>
              <ActionButton primary onClick={primary.onClick}>
                <primary.Icon size={15} strokeWidth={1.5} />
                {primary.label}
              </ActionButton>
            </div>
          </footer>
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
          @keyframes cd-drawer-in {
            from { opacity: 0; transform: translateX(12px); }
            to   { opacity: 1; transform: translateX(0); }
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

/** Proof one-liner (§3.3) — the three facts a records tool must state
 *  inline: encrypted, versioned, verified. Mirrors the DetailsPanel
 *  compliance card's summary in a single row. */
function ProofOneLiner({ version }: { version: number }) {
  const v = Math.max(version, 1);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 3,
        fontSize: "var(--text-xs)",
        color: "var(--fg-muted)",
      }}
    >
      <ShieldCheck
        size={13}
        strokeWidth={1.6}
        aria-hidden
        style={{ color: "var(--status-verified-700)", flexShrink: 0 }}
      />
      <span>
        Encrypted · <span className="mono">v{v}</span> ·{" "}
        <span style={{ color: "var(--status-verified-700)", fontWeight: "var(--weight-medium)" }}>
          ✓ Verified
        </span>
      </span>
    </div>
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
