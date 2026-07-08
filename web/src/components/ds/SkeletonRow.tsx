/**
 * SkeletonRow — a loading placeholder that mirrors the dense vault table's
 * column widths so the layout doesn't jump when rows land. Uses the
 * `.skeleton` shimmer utility (static under prefers-reduced-motion).
 */

/** Column template shared by the vault header, rows, and skeleton.
 * M6 relayout (ui-redesign-v3 §2.1): Kind / Lock / Encryption columns
 * dropped; Version stays conditional (empty placeholder cell when not
 * compliance-significant, so the grid stays aligned). The row's kebab is
 * no longer a grid track — actions fade in over the right edge on hover
 * (§2.2 "actions fade in right"), so they don't consume a column.
 * Tracks: select · name · version* · status · modified · size. */
export const VAULT_GRID = "24px minmax(0,1fr) 56px 112px 96px 68px";

/** Approx bar widths per column (name is widest; size is right-aligned). */
const BAR_WIDTHS = ["16px", "60%", "28px", "64px", "72px", "40px"];

export function SkeletonRow({ columns = BAR_WIDTHS.length }: { columns?: number }) {
  const widths = BAR_WIDTHS.slice(0, columns);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: VAULT_GRID,
        alignItems: "center",
        height: 32,
        padding: "0 var(--space-3)",
        gap: "var(--space-3)",
        borderBottom: "var(--border-w) solid var(--border)",
      }}
    >
      {widths.map((w, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 10, width: w, borderRadius: "var(--radius-2xs)" }}
        />
      ))}
    </div>
  );
}
