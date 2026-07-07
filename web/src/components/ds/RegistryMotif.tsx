import {
  FileSearch,
  FileText,
  Gavel,
  Layers,
  Lock,
  ScrollText,
  Share2,
  type LucideIcon,
} from "lucide-react";

/**
 * RegistryMotif — the app's signature empty-state illustration
 * (ui-empty-states §1.2). Lucide `Layers` echoes the logo's three offset
 * sheets so "empty" always reads as "empty registry". An optional concept
 * glyph from the security set overlays bottom-right. Line-art only,
 * `--fg-subtle` at rest, never animates, always `aria-hidden`.
 */
export type MotifOverlay =
  | "lock"
  | "file-text"
  | "file-search"
  | "layers"
  | "scroll-text"
  | "gavel"
  | "share-2";

const OVERLAY_ICON: Record<MotifOverlay, LucideIcon> = {
  lock: Lock,
  "file-text": FileText,
  "file-search": FileSearch,
  layers: Layers,
  "scroll-text": ScrollText,
  gavel: Gavel,
  "share-2": Share2,
};

export function RegistryMotif({
  overlay,
  size = 24,
  tone = "subtle",
}: {
  overlay?: MotifOverlay;
  size?: number;
  tone?: "subtle" | "danger";
}) {
  const color = tone === "danger" ? "var(--status-danger)" : "var(--fg-subtle)";
  const Overlay = overlay ? OVERLAY_ICON[overlay] : null;
  const box = 64;
  const overlaySize = Math.round(size * 0.55);
  return (
    <span
      aria-hidden
      style={{
        position: "relative",
        width: box,
        height: box,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color,
      }}
    >
      <Layers size={size} strokeWidth={1.5} />
      {Overlay && (
        <span
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            display: "inline-flex",
            padding: 2,
            background: "var(--bg-canvas)",
            borderRadius: "var(--radius-2xs)",
            color,
          }}
        >
          <Overlay size={overlaySize} strokeWidth={1.5} />
        </span>
      )}
    </span>
  );
}
