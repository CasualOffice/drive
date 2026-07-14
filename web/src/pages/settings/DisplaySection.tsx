/**
 * Display section — the relocated home for theme, default vault view, and
 * row density (M6 moved view + density off the top bar). Theme is owned by
 * <ThemeToggle> (persists `localStorage.theme`); view + density persist to
 * the shared `cd:files:*` keys the vault reads on load.
 */
import { useState } from "react";
import { LayoutGrid, Rows3, Rows4, Rows as RowsIcon } from "lucide-react";

import { ThemeToggle } from "../../components/ThemeToggle.tsx";
import { SettingsCard, SettingsHeader } from "./SettingsHeader.tsx";

const VIEW_KEY = "cd:files:view";
const DENSITY_KEY = "cd:files:density";

type ViewMode = "grid" | "list";
type Density = "comfortable" | "compact";

function read<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(key);
    return (valid as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — silent */
  }
  // Tell the live Shell to re-read view/density immediately — the `storage`
  // event only fires in OTHER tabs, so a same-tab change needs this nudge.
  window.dispatchEvent(new CustomEvent("cd:display"));
}

export function DisplaySection() {
  const [view, setView] = useState<ViewMode>(() => read(VIEW_KEY, "grid", ["grid", "list"]));
  const [density, setDensity] = useState<Density>(() =>
    read(DENSITY_KEY, "comfortable", ["comfortable", "compact"]),
  );

  return (
    <>
      <SettingsHeader
        title="Display"
        description="How Doc-Hub looks for you — theme, the default vault layout, and how dense the document rows are. These preferences are stored on this device."
      />

      <SettingsCard title="Theme" subtitle="Light, dark, or follow your operating system.">
        <div data-testid="settings-display-theme">
          <ThemeToggle />
        </div>
      </SettingsCard>

      <SettingsCard title="Default view" subtitle="The layout the vault opens with.">
        <Segmented
          testId="settings-display-view"
          value={view}
          onChange={(v) => {
            setView(v);
            write(VIEW_KEY, v);
          }}
          options={[
            { id: "grid", label: "Grid", icon: <LayoutGrid size={15} strokeWidth={1.6} /> },
            { id: "list", label: "List", icon: <RowsIcon size={15} strokeWidth={1.6} /> },
          ]}
        />
      </SettingsCard>

      <SettingsCard title="Row density" subtitle="Comfortable spacing, or compact to fit more on screen.">
        <Segmented
          testId="settings-display-density"
          value={density}
          onChange={(v) => {
            setDensity(v);
            write(DENSITY_KEY, v);
          }}
          options={[
            { id: "comfortable", label: "Comfortable", icon: <Rows3 size={15} strokeWidth={1.6} /> },
            { id: "compact", label: "Compact", icon: <Rows4 size={15} strokeWidth={1.6} /> },
          ]}
        />
      </SettingsCard>
    </>
  );
}

function Segmented<T extends string>({
  testId,
  value,
  onChange,
  options,
}: {
  testId: string;
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon: React.ReactNode }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Display option"
      style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: "var(--radius-md)", border: "var(--border-w) solid var(--border)", background: "var(--bg-sunken)" }}
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`${testId}-${o.id}`}
            onClick={() => onChange(o.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: "var(--radius-sm)",
              border: `var(--border-w) solid ${active ? "var(--border)" : "transparent"}`,
              background: active ? "var(--violet-100)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              color: active ? "var(--ink)" : "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-sm)",
              fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
              cursor: "pointer",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
