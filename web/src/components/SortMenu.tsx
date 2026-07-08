/**
 * Sort dropdown — Radix DropdownMenu wrapped in our token palette.
 * Spec: docs/ux/09-sort-and-select.md.
 *
 * The component is purely presentational: state lives in <Files/> so it
 * can drive the actual sort + persist the selection.
 */
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { DropdownMenu } from "radix-ui";

export type SortKey = "name" | "modified" | "size";
export type SortDir = "asc" | "desc";

const KEYS: { id: SortKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "modified", label: "Modified" },
  { id: "size", label: "Size" },
];

export function SortMenu({
  sortKey,
  sortDir,
  onChange,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onChange: (key: SortKey, dir: SortDir) => void;
}) {
  const activeLabel = KEYS.find((k) => k.id === sortKey)?.label ?? "Name";
  const ArrowIcon = sortDir === "asc" ? ArrowUp : ArrowDown;
  // SR14 — expose the live selection in the trigger label so screen
  // readers don't just hear "Sort, button" with no state.
  const triggerAriaLabel = `Sort by ${activeLabel}, ${
    sortDir === "asc" ? "ascending" : "descending"
  }`;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="press-sink" style={triggerStyle()} aria-label={triggerAriaLabel}>
          <ArrowUpDown
            size={13}
            strokeWidth={1.8}
            aria-hidden="true"
            style={{ color: "var(--muted)" }}
          />
          <span>{activeLabel}</span>
          <ArrowIcon
            size={12}
            strokeWidth={2}
            aria-hidden="true"
            style={{ color: "var(--muted)", marginLeft: 2 }}
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} style={menuStyle()}>
          <Label>Sort by</Label>
          {/* SR14 — radio semantics so screen readers announce
              "checked" / "not checked" instead of just "menu item". */}
          <DropdownMenu.RadioGroup
            value={sortKey}
            onValueChange={(v) => onChange(v as SortKey, sortDir)}
          >
            {KEYS.map((k) => (
              <RadioItem key={k.id} value={k.id} active={k.id === sortKey}>
                {k.label}
              </RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <Sep />
          <Label>Direction</Label>
          <DropdownMenu.RadioGroup
            value={sortDir}
            onValueChange={(v) => onChange(sortKey, v as SortDir)}
          >
            <RadioItem value="asc" active={sortDir === "asc"}>
              <ArrowUp
                size={13}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{ color: "var(--muted)" }}
              />
              Ascending
            </RadioItem>
            <RadioItem value="desc" active={sortDir === "desc"}>
              <ArrowDown
                size={13}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{ color: "var(--muted)" }}
              />
              Descending
            </RadioItem>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Radix `RadioItem` already maps to `role="menuitemradio"` +
 * `aria-checked`. Wrapping it here keeps the visual tick + hover
 * styles consistent with the rest of the dropdown surface. */
function RadioItem({
  value,
  active,
  children,
}: {
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      onSelect={(e) => e.preventDefault()}
      style={{
        ...itemStyle(),
        background: active ? "var(--violet-100)" : "transparent",
        color: "var(--ink)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = active ? "var(--violet-100)" : "transparent")
      }
    >
      {children}
      {active && <Tick />}
    </DropdownMenu.RadioItem>
  );
}

function Tick() {
  return (
    <Check
      size={13}
      strokeWidth={2.2}
      aria-hidden="true"
      style={{ marginLeft: "auto", color: "var(--violet-500)" }}
    />
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Label
      className="caps-label"
      style={{
        padding: "8px 10px 4px",
      }}
    >
      {children}
    </DropdownMenu.Label>
  );
}

function Sep() {
  return (
    <DropdownMenu.Separator style={{ height: "var(--border-w)", background: "var(--border)", margin: "4px 6px" }} />
  );
}

function triggerStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: "var(--radius-sm)",
    border: "var(--border-w) solid var(--border)",
    background: "var(--card)",
    color: "var(--ink)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
  };
}

function menuStyle(): React.CSSProperties {
  return {
    minWidth: 200,
    background: "var(--card)",
    border: "var(--border-w) solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-lg)",
    padding: 6,
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    color: "var(--ink)",
    zIndex: 60,
    animation: "cd-menu-in 180ms var(--ease)",
  };
}

function itemStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    userSelect: "none",
    outline: "none",
    transition: "background 120ms",
  };
}
