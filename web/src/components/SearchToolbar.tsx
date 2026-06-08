/**
 * Phase 3 search toolbar — chip row above the result grid.
 * Spec: docs/ux/12-search-surface.md.
 *
 * Renders:
 *   - Scope chip on the left (Folder / Workspace / All my workspaces)
 *   - Filter chips: Type · Modified · Created · Size · Has share · In trash · Workspace
 *   - Right side: Sort popover + "Clear all" link when any filter active
 *
 * Owner chip is deferred until the member-listing endpoint lands —
 * tracked as SR-OWNER in PIPELINE.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  FileType2,
  FolderOpen,
  Globe,
  HardDrive,
  Link as LinkIcon,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";

import {
  listWorkspaceMembers,
  type SearchFilters,
  type SearchScope,
  type SortBy,
  type SortDir,
  type TypeBucket,
  type Workspace,
  type WorkspaceMember,
} from "../api/client.ts";

interface Props {
  filters: SearchFilters;
  sort: SortBy;
  sortDir: SortDir;
  /** Available workspaces for the workspace chip + count chip. */
  workspaces: Workspace[];
  /** Active workspace label for the Scope = "folder"/"workspace" copy. */
  activeWorkspaceName: string;
  /** True ⇒ user is currently inside a non-root folder; scope=folder allowed. */
  insideFolder: boolean;
  /** Active workspace id — used by the Owner chip to fetch members. */
  activeWorkspaceId: string | null;
  onFiltersChange: (next: SearchFilters) => void;
  onSortChange: (sort: SortBy, dir: SortDir) => void;
  onClearAll: () => void;
}

export function SearchToolbar({
  filters,
  sort,
  sortDir,
  workspaces,
  activeWorkspaceName,
  insideFolder,
  activeWorkspaceId,
  onFiltersChange,
  onSortChange,
  onClearAll,
}: Props) {
  const anyActive =
    filters.types.length > 0 ||
    filters.owner_ids.length > 0 ||
    !!filters.modified_after || !!filters.modified_before ||
    !!filters.created_after || !!filters.created_before ||
    filters.size_min !== undefined || filters.size_max !== undefined ||
    filters.has_share_link !== undefined ||
    !!filters.include_trashed ||
    (filters.workspace_ids?.length ?? 0) > 0;

  const update = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  return (
    <div role="toolbar" aria-label="Search filters" style={rowStyle()}>
      {/* Scope chip — always present, leftmost */}
      <ScopeChip
        scope={filters.scope}
        insideFolder={insideFolder}
        hasMultipleWorkspaces={workspaces.length > 1}
        activeWorkspaceName={activeWorkspaceName}
        onChange={(scope) => update("scope", scope)}
      />

      <Divider />

      {/* Filter chips */}
      <TypeChipPopover
        value={filters.types}
        onChange={(types) => update("types", types)}
      />
      <OwnerChipPopover
        workspaceId={activeWorkspaceId}
        value={filters.owner_ids}
        onChange={(ids) => update("owner_ids", ids)}
      />
      <DateRangeChipPopover
        label="Modified"
        icon={<Calendar size={12} strokeWidth={1.8} />}
        after={filters.modified_after}
        before={filters.modified_before}
        onChange={(after, before) => onFiltersChange({ ...filters, modified_after: after, modified_before: before })}
      />
      <DateRangeChipPopover
        label="Created"
        icon={<Calendar size={12} strokeWidth={1.8} />}
        after={filters.created_after}
        before={filters.created_before}
        onChange={(after, before) => onFiltersChange({ ...filters, created_after: after, created_before: before })}
      />
      <SizeChipPopover
        min={filters.size_min}
        max={filters.size_max}
        onChange={(min, max) => onFiltersChange({ ...filters, size_min: min, size_max: max })}
      />
      <ToggleChip
        label="Has share link"
        icon={<LinkIcon size={12} strokeWidth={1.8} />}
        value={filters.has_share_link}
        onChange={(v) => update("has_share_link", v)}
      />
      <ToggleChip
        label="In trash"
        icon={<Trash2 size={12} strokeWidth={1.8} />}
        value={filters.include_trashed}
        onChange={(v) => update("include_trashed", v ?? undefined)}
      />
      {workspaces.length > 1 && (
        <WorkspaceChipPopover
          all={workspaces}
          selected={filters.workspace_ids ?? []}
          onChange={(ids) => update("workspace_ids", ids.length ? ids : undefined)}
        />
      )}

      {/* Spacer pushes Sort + Clear to the right */}
      <span style={{ flex: 1 }} />

      {anyActive && (
        <button type="button" onClick={onClearAll} style={clearStyle()} aria-label="Clear all filters">
          Clear all
        </button>
      )}
      <SortPopover sort={sort} sortDir={sortDir} onChange={onSortChange} />
    </div>
  );
}

// ── Scope ────────────────────────────────────────────────────────────

function ScopeChip({
  scope,
  insideFolder,
  hasMultipleWorkspaces,
  activeWorkspaceName,
  onChange,
}: {
  scope: SearchScope;
  insideFolder: boolean;
  hasMultipleWorkspaces: boolean;
  activeWorkspaceName: string;
  onChange: (s: SearchScope) => void;
}) {
  const options: { value: SearchScope; label: string; disabled?: boolean }[] = [
    { value: "folder", label: "Current folder", disabled: !insideFolder },
    { value: "workspace", label: activeWorkspaceName },
    {
      value: "all",
      label: "All my workspaces",
      disabled: !hasMultipleWorkspaces,
    },
  ];
  const activeLabel = options.find((o) => o.value === scope)?.label ?? activeWorkspaceName;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(false)} aria-label="Search scope">
          <FolderOpen size={12} strokeWidth={1.8} style={{ color: "var(--muted)" }} />
          <span>{activeLabel}</span>
          <ChevronDownTiny />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>Scope</Label>
          {options.map((o) => (
            <RadioRow
              key={o.value}
              label={o.label}
              checked={o.value === scope}
              disabled={o.disabled}
              onSelect={() => !o.disabled && onChange(o.value)}
            />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Type ─────────────────────────────────────────────────────────────

const TYPE_LABELS: { value: TypeBucket; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "document", label: "Document" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "markdown", label: "Markdown" },
  { value: "archive", label: "Archive" },
  { value: "note", label: "Note" },
];

function TypeChipPopover({
  value,
  onChange,
}: {
  value: TypeBucket[];
  onChange: (next: TypeBucket[]) => void;
}) {
  const active = value.length > 0;
  const summary =
    value.length === 0
      ? "Type"
      : value.length === 1
        ? `Type: ${TYPE_LABELS.find((t) => t.value === value[0])?.label}`
        : `Type: ${value.length} selected`;
  const toggle = (bucket: TypeBucket) => {
    onChange(
      value.includes(bucket) ? value.filter((b) => b !== bucket) : [...value, bucket],
    );
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label="Filter by type" aria-pressed={active}>
          <FileType2 size={12} strokeWidth={1.8} style={{ color: active ? "var(--accent)" : "var(--muted)" }} />
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>File type</Label>
          {TYPE_LABELS.map((t) => (
            <CheckRow
              key={t.value}
              label={t.label}
              checked={value.includes(t.value)}
              onSelect={() => toggle(t.value)}
            />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Owner ────────────────────────────────────────────────────────────

/** Per-workspace cache of members loaded this session. The chip opens
 * lazily — first open triggers the fetch, subsequent opens are instant.
 * Cleared by reload, which is fine for a "list members" call. */
const ownerCache = new Map<string, WorkspaceMember[]>();

function OwnerChipPopover({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const active = value.length > 0;
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[] | null>(
    workspaceId ? ownerCache.get(workspaceId) ?? null : null,
  );
  const [filterText, setFilterText] = useState("");

  useEffect(() => {
    if (!open || !workspaceId || members) return;
    let alive = true;
    void (async () => {
      try {
        const r = await listWorkspaceMembers(workspaceId);
        if (!alive) return;
        ownerCache.set(workspaceId, r.members);
        setMembers(r.members);
      } catch {
        if (alive) setMembers([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, workspaceId, members]);

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.username.toLowerCase().includes(q));
  }, [members, filterText]);

  const summary = !active
    ? "Owner"
    : value.length === 1
      ? `Owner: ${members?.find((m) => m.user_id === value[0])?.username ?? "1 selected"}`
      : `Owner: ${value.length} selected`;

  const toggle = (userId: string) =>
    onChange(
      value.includes(userId) ? value.filter((x) => x !== userId) : [...value, userId],
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label="Filter by owner" aria-pressed={active}>
          <User size={12} strokeWidth={1.8} style={{ color: active ? "var(--accent)" : "var(--muted)" }} />
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>Owner</Label>
          <div style={{ padding: "4px 8px 6px" }}>
            <input
              type="text"
              placeholder="Filter members…"
              autoFocus
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={dateInputStyle()}
            />
          </div>
          {members === null && (
            <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              Loading…
            </div>
          )}
          {members && members.length === 0 && (
            <div style={{ padding: "8px 12px", color: "var(--muted)", fontSize: "var(--text-sm)" }}>
              No members.
            </div>
          )}
          {filtered.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {filtered.map((m) => (
                <CheckRow
                  key={m.user_id}
                  label={`${m.username}${m.is_admin ? "  ·  Admin" : ""}`}
                  checked={value.includes(m.user_id)}
                  onSelect={() => toggle(m.user_id)}
                />
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Date range (Modified / Created) ──────────────────────────────────

const RANGE_PRESETS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function rfcFromDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function DateRangeChipPopover({
  label,
  icon,
  after,
  before,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  after: string | undefined;
  before: string | undefined;
  onChange: (after: string | undefined, before: string | undefined) => void;
}) {
  const active = !!after || !!before;
  // Inline relative-shortcut detection — if `after` is "N days ago" exact and `before` empty, render as the preset's label.
  const summary = !active
    ? label
    : after && !before
      ? presetLabelFor(after) ?? `${label}: custom`
      : `${label}: custom`;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label={`Filter by ${label.toLowerCase()}`} aria-pressed={active}>
          <span style={{ color: active ? "var(--accent)" : "var(--muted)" }}>{icon}</span>
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined, undefined);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>{label}</Label>
          {RANGE_PRESETS.map((p) => (
            <RadioRow
              key={p.label}
              label={p.label}
              checked={after === rfcFromDaysAgoSticky(p.days) /* never true — guidance only */}
              onSelect={() => onChange(rfcFromDaysAgo(p.days), undefined)}
            />
          ))}
          <Sep />
          <Label>Custom range</Label>
          <div style={{ display: "flex", gap: 6, padding: "4px 10px 10px" }}>
            <DateInput
              value={after}
              placeholder="From"
              onChange={(v) => onChange(v, before)}
            />
            <DateInput
              value={before}
              placeholder="To"
              onChange={(v) => onChange(after, v)}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Returns the matching preset label when `after` is approximately one
 * of our shortcut offsets. Tolerant to ± 60 s drift. */
function presetLabelFor(afterRfc: string): string | null {
  const ms = Date.now() - new Date(afterRfc).getTime();
  const days = Math.round(ms / 86_400_000);
  for (const p of RANGE_PRESETS) {
    if (Math.abs(days - p.days) <= 1) return p.label;
  }
  return null;
}

/** Sentinel value never equal to a real `after` — used as a noop in
 * the preset checked-state above. (The chips show the preset's text in
 * the summary instead; per-row check ticks aren't meaningful for
 * a moving "N days ago" target.) */
function rfcFromDaysAgoSticky(_days: number): string {
  return "__never__";
}

function DateInput({
  value,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  placeholder: string;
  onChange: (v: string | undefined) => void;
}) {
  const local = value ? value.slice(0, 10) : "";
  return (
    <input
      type="date"
      aria-label={placeholder}
      placeholder={placeholder}
      value={local}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) {
          onChange(undefined);
          return;
        }
        // Convert yyyy-mm-dd → 00:00 UTC RFC3339.
        const iso = new Date(`${v}T00:00:00Z`).toISOString();
        onChange(iso);
      }}
      style={dateInputStyle()}
    />
  );
}

// ── Size ─────────────────────────────────────────────────────────────

const SIZE_BANDS: { label: string; min?: number; max?: number }[] = [
  { label: "≤ 1 MB", max: 1_000_000 },
  { label: "1 – 10 MB", min: 1_000_000, max: 10_000_000 },
  { label: "10 – 100 MB", min: 10_000_000, max: 100_000_000 },
  { label: "≥ 100 MB", min: 100_000_000 },
];

function SizeChipPopover({
  min,
  max,
  onChange,
}: {
  min: number | undefined;
  max: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  const active = min !== undefined || max !== undefined;
  const activeBand = SIZE_BANDS.find((b) => b.min === min && b.max === max);
  const summary = !active ? "Size" : activeBand ? `Size: ${activeBand.label}` : "Size: custom";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label="Filter by size" aria-pressed={active}>
          <HardDrive size={12} strokeWidth={1.8} style={{ color: active ? "var(--accent)" : "var(--muted)" }} />
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined, undefined);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>Size</Label>
          {SIZE_BANDS.map((b) => (
            <RadioRow
              key={b.label}
              label={b.label}
              checked={b.min === min && b.max === max}
              onSelect={() => onChange(b.min, b.max)}
            />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Toggle chip (Has share link, In trash) ───────────────────────────

function ToggleChip({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: boolean | undefined;
  onChange: (next: boolean | undefined) => void;
}) {
  const active = value !== undefined;
  const summary = !active
    ? label
    : value === true
      ? `${label}: yes`
      : `${label}: no`;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label={label} aria-pressed={active}>
          <span style={{ color: active ? "var(--accent)" : "var(--muted)" }}>{icon}</span>
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>{label}</Label>
          <RadioRow label="Either (any)" checked={value === undefined} onSelect={() => onChange(undefined)} />
          <RadioRow label="Yes" checked={value === true} onSelect={() => onChange(true)} />
          <RadioRow label="No" checked={value === false} onSelect={() => onChange(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Workspace ────────────────────────────────────────────────────────

function WorkspaceChipPopover({
  all,
  selected,
  onChange,
}: {
  all: Workspace[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const active = selected.length > 0;
  const summary = !active
    ? "Workspace"
    : selected.length === 1
      ? `Workspace: ${all.find((w) => w.id === selected[0])?.name ?? "1 selected"}`
      : `Workspace: ${selected.length} selected`;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(active)} aria-label="Filter by workspace" aria-pressed={active}>
          <Globe size={12} strokeWidth={1.8} style={{ color: active ? "var(--accent)" : "var(--muted)" }} />
          <span>{summary}</span>
          {active ? (
            <ClearMini
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          ) : (
            <ChevronDownTiny />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={popoverStyle()}>
          <Label>Workspaces</Label>
          {all.map((w) => (
            <CheckRow
              key={w.id}
              label={w.name}
              checked={selected.includes(w.id)}
              onSelect={() => toggle(w.id)}
            />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Sort ─────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "modified", label: "Modified" },
  { value: "created", label: "Created" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
];

function SortPopover({
  sort,
  sortDir,
  onChange,
}: {
  sort: SortBy;
  sortDir: SortDir;
  onChange: (sort: SortBy, dir: SortDir) => void;
}) {
  const label = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Relevance";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" style={chipStyle(false)} aria-label="Sort">
          <ArrowUpDown size={12} strokeWidth={1.8} style={{ color: "var(--muted)" }} />
          <span>Sort: {label}</span>
          {sortDir === "asc" ? (
            <ArrowUp size={11} strokeWidth={2} style={{ color: "var(--muted)" }} />
          ) : (
            <ArrowDown size={11} strokeWidth={2} style={{ color: "var(--muted)" }} />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} style={popoverStyle()}>
          <Label>Sort by</Label>
          {SORT_OPTIONS.map((o) => (
            <RadioRow
              key={o.value}
              label={o.label}
              checked={o.value === sort}
              onSelect={() => onChange(o.value, sortDir)}
            />
          ))}
          <Sep />
          <Label>Direction</Label>
          <RadioRow
            label="Ascending"
            checked={sortDir === "asc"}
            onSelect={() => onChange(sort, "asc")}
          />
          <RadioRow
            label="Descending"
            checked={sortDir === "desc"}
            onSelect={() => onChange(sort, "desc")}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Shared primitives ────────────────────────────────────────────────

function CheckRow({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={rowItemStyle()}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 4,
          border: `1.5px solid ${checked ? "var(--accent)" : "var(--line-strong)"}`,
          background: checked ? "var(--accent)" : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={10} strokeWidth={3} style={{ color: "var(--paper)" }} />}
      </span>
      <span>{label}</span>
    </button>
  );
}

function RadioRow({
  label,
  checked,
  disabled,
  onSelect,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      style={{ ...rowItemStyle(), opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1.5px solid ${checked ? "var(--accent)" : "var(--line-strong)"}`,
          background: "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && (
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

function ClearMini({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <span
      role="button"
      aria-label="Clear"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 2,
        cursor: "pointer",
      }}
    >
      <X size={11} strokeWidth={2} style={{ color: "var(--muted)" }} />
    </span>
  );
}

function ChevronDownTiny() {
  return (
    <svg width={9} height={9} viewBox="0 0 8 8" fill="none" style={{ marginLeft: 2 }}>
      <path d="M1 2.5L4 5.5L7 2.5" stroke="var(--muted)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 16, background: "var(--line)", margin: "0 4px" }} />;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "2px",
        textTransform: "uppercase",
        color: "var(--muted-2)",
        fontWeight: 600,
        padding: "8px 10px 4px",
      }}
    >
      {children}
    </div>
  );
}

function Sep() {
  return <div style={{ height: 1, background: "var(--line)", margin: "4px 6px" }} />;
}

function rowStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    padding: "10px 0 12px",
  };
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    background: active ? "var(--accent-muted)" : "var(--card)",
    color: active ? "var(--ink)" : "var(--ink-soft)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    fontWeight: 500,
    transition: "background 150ms, border-color 150ms",
    outline: "none",
  };
}

function popoverStyle(): React.CSSProperties {
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

function rowItemStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    width: "100%",
    background: "transparent",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    transition: "background 120ms",
    outline: "none",
  };
}

function dateInputStyle(): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    outline: "none",
  };
}

function clearStyle(): React.CSSProperties {
  return {
    background: "transparent",
    border: "none",
    color: "var(--muted)",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    padding: "6px 8px",
    textDecoration: "underline",
    textUnderlineOffset: 2,
  };
}

