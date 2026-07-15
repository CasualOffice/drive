/**
 * VersionHistory — Doc-Hub's flagship compliance surface (UX-18).
 * Spec: docs/ux/18-version-history-surface.md, docs/design/ui-system-neobrutal.md
 * §5 (the "Ledger"), §6 (the Stamp / the Press signature moments).
 *
 * Renders the append-only, hash-chained version timeline for one document,
 * head first, as a hard-edged bordered LEDGER: each version is a 2px-ink
 * bordered card down a 2px ink rail with square nodes. The head/current node
 * is violet-filled. On **Verify chain**, the violet fills node-to-node UP the
 * rail and each row's `SEALED` chip **stamps in** (quick scale-overshoot +
 * settle — "The Stamp"). Every button **presses into** its offset shadow on
 * click ("The Press"). A broken chain surfaces a persistent, non-dismissible
 * `role="alert"` tamper alarm at the top. Restore is additive.
 *
 * Two forms from one component:
 *   - variant="panel" — the 360px docked form (DetailsPanel History tab)
 *   - variant="full"  — the full-width route (/document/{id}/history)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Copy,
  Download,
  Gavel,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";

import {
  ApiError,
  listVersions,
  restoreVersion,
  verifyChain,
  versionContentUrl,
  type FileVersion,
  type VerifyResult,
} from "../api/client.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RegistryMotif } from "./ds/RegistryMotif.tsx";
import { SkeletonRow } from "./ds/SkeletonRow.tsx";
import { StatusChip } from "./ds/StatusChip.tsx";

const STROKE = 2;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** null = not yet verified this session; falls back to the list's
 * `chain_verified`. Otherwise the outcome of an explicit Verify. */
type BadgeState =
  | { kind: "unknown" }
  | { kind: "intact" }
  | { kind: "broken"; atSeq: number };

export function VersionHistory({
  fileId,
  fileName,
  variant = "full",
  onRestored,
}: {
  fileId: string;
  fileName: string;
  variant?: "panel" | "full";
  /** Fired after a successful restore with the new head seq — lets a
   *  host refresh its own file metadata. */
  onRestored?: (newSeq: number) => void;
}) {
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [chainVerified, setChainVerified] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [badge, setBadge] = useState<BadgeState>({ kind: "unknown" });
  const [verifying, setVerifying] = useState(false);
  const [restoreSeq, setRestoreSeq] = useState<number | null>(null);
  // The Stamp climb — how many nodes (from the oldest, bottom of the rail)
  // have been sealed so far. Drives the violet rail-fill + per-row SEALED
  // stamp. 0 until an explicit Verify climbs the chain.
  const [sealedCount, setSealedCount] = useState(0);
  const climbRef = useRef<number | null>(null);

  const stopClimb = useCallback(() => {
    if (climbRef.current != null) {
      window.clearInterval(climbRef.current);
      climbRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    setSealedCount(0);
    try {
      const resp = await listVersions(fileId);
      const sorted = [...resp.versions].sort((a, b) => b.seq - a.seq);
      setVersions(sorted);
      setChainVerified(resp.chain_verified);
      setBadge(resp.chain_verified ? { kind: "unknown" } : { kind: "broken", atSeq: resp.head_seq });
    } catch (e) {
      setErr((e as ApiError).message ?? "Couldn't load version history.");
      setVersions([]);
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => stopClimb(), [stopClimb]);

  async function runVerify() {
    if (verifying) return;
    setVerifying(true);
    stopClimb();
    setSealedCount(0);
    try {
      const r: VerifyResult = await verifyChain(fileId);
      if (r.status === "intact") {
        setBadge({ kind: "intact" });
        setChainVerified(true);
        toast.success("Chain verified · every link intact");
        // The Stamp — climb the rail node-to-node, sealing each row.
        const total = versions?.length ?? 0;
        if (prefersReducedMotion() || total <= 1) {
          setSealedCount(total);
        } else {
          let n = 0;
          climbRef.current = window.setInterval(() => {
            n += 1;
            setSealedCount(n);
            if (n >= total) stopClimb();
          }, 150);
        }
      } else {
        setBadge({ kind: "broken", atSeq: r.at_seq });
        setChainVerified(false);
      }
    } catch (e) {
      toast.error((e as ApiError).message ?? "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  async function doRestore(seq: number) {
    const updated = await restoreVersion(fileId, seq);
    toast.success(`Version ${updated.version} saved · restored from v${seq}`);
    await load();
    onRestored?.(updated.version);
  }

  // Resolved tamper state — an explicit broken badge, or a list that
  // arrived already flagged. Persistent; drives the top-of-panel alarm.
  const broken =
    badge.kind === "broken"
      ? badge.atSeq
      : !chainVerified && versions && versions.length > 0
        ? versions[versions.length - 1].seq
        : null;

  return (
    <section
      aria-label={`Version history for ${fileName}`}
      style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}
    >
      <LedgerStyles />
      <Header
        fileName={fileName}
        variant={variant}
        badge={broken != null ? { kind: "broken", atSeq: broken } : badge}
        verifying={verifying}
        onVerify={runVerify}
        canVerify={!!versions && versions.length > 0}
      />

      {broken != null && <TamperAlarm atSeq={broken} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {err && (
          <div role="alert" style={errBox}>
            <div>{err}</div>
            <button type="button" onClick={() => void load()} className="press-sink" style={errRetryBtn}>
              <RotateCw size={14} strokeWidth={1.5} />
              Try again
            </button>
          </div>
        )}

        {versions === null ? (
          <LoadingTimeline />
        ) : versions.length === 0 && !err ? (
          <EmptyChain />
        ) : versions.length === 1 ? (
          <>
            <Timeline
              versions={versions}
              fileId={fileId}
              broken={broken}
              sealedCount={sealedCount}
              onRestore={setRestoreSeq}
            />
            <OneVersion />
          </>
        ) : (
          <Timeline
            versions={versions}
            fileId={fileId}
            broken={broken}
            sealedCount={sealedCount}
            onRestore={setRestoreSeq}
          />
        )}
      </div>

      {versions && versions.length > 0 && (
        <Footer count={versions.length} verified={broken == null && chainVerified} />
      )}

      <ConfirmDialog
        open={restoreSeq !== null}
        title={restoreSeq !== null ? `Restore v${restoreSeq} as a new version?` : ""}
        body={
          restoreSeq !== null
            ? `This appends a new head, byte-identical to v${restoreSeq}. The current version and all prior versions are kept — nothing is destroyed.`
            : undefined
        }
        confirmLabel="Restore"
        onConfirm={async () => {
          if (restoreSeq === null) return;
          try {
            await doRestore(restoreSeq);
          } catch (e) {
            toast.error((e as ApiError).message ?? "Restore failed.");
            throw e; // keep the dialog open for retry
          }
        }}
        onClose={() => setRestoreSeq(null)}
      />
    </section>
  );
}

/** Keyframes for the Ledger's signature moments — injected once. The Stamp
 *  (scale-overshoot slam + settle) and the violet rail-fill climb. The
 *  global prefers-reduced-motion rule (tokens.css) caps these to ~1ms so
 *  sealed state snaps in without motion. */
function LedgerStyles() {
  return (
    <style>{`
      @keyframes vh-stamp {
        0%   { opacity: 0; transform: scale(1.9) rotate(-3deg); }
        55%  { opacity: 1; transform: scale(0.88) rotate(1deg); }
        78%  { transform: scale(1.06) rotate(0); }
        100% { opacity: 1; transform: scale(1) rotate(0); }
      }
      @keyframes vh-node-pop {
        0%   { transform: scale(0.5); }
        60%  { transform: scale(1.18); }
        100% { transform: scale(1); }
      }
      .vh-stamp  { animation: vh-stamp 320ms var(--ease-seal) both; }
      .vh-node-seal { animation: vh-node-pop 260ms var(--ease-seal) both; }
    `}</style>
  );
}

// ── Header ─────────────────────────────────────────────────────────────

function Header({
  fileName,
  variant,
  badge,
  verifying,
  onVerify,
  canVerify,
}: {
  fileName: string;
  variant: "panel" | "full";
  badge: BadgeState;
  verifying: boolean;
  onVerify: () => void;
  canVerify: boolean;
}) {
  return (
    <header
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3)",
        marginBottom: "var(--space-3)",
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {variant === "full" && (
          <div className="caps-label" style={{ marginBottom: 4, color: "var(--violet-500)" }}>
            The Ledger
          </div>
        )}
        <div
          style={{
            fontSize: variant === "full" ? "var(--text-xl)" : "var(--text-lg)",
            fontWeight: "var(--weight-bold)",
            color: "var(--fg-default)",
            letterSpacing: "var(--tracking-tight)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fileName}
        </div>
        <div style={{ marginTop: 4 }}>
          <Badge badge={badge} />
        </div>
      </div>
      <button
        type="button"
        onClick={onVerify}
        disabled={!canVerify || verifying}
        className="press-sink-lg"
        style={verifyBtn(!canVerify || verifying)}
      >
        <ShieldCheck size={15} strokeWidth={STROKE} aria-hidden />
        {verifying ? "Verifying…" : "Verify chain"}
      </button>
    </header>
  );
}

/** The two-variant verification badge (§7.5) — icon + label, never
 *  colour alone. `unknown` reads as the calm verified default. */
function Badge({ badge }: { badge: BadgeState }) {
  if (badge.kind === "broken") {
    return (
      <StatusChip
        tone="danger"
        icon={<ShieldOff size={13} strokeWidth={STROKE} />}
        label="Tamper detected"
        title={`Tamper detected — chain verification failed at v${badge.atSeq}`}
      />
    );
  }
  return (
    <StatusChip
      tone="verified"
      icon={<ShieldCheck size={13} strokeWidth={STROKE} />}
      label="Verified"
      title="Chain intact — every link verified"
    />
  );
}

// ── Tamper alarm (§8.2 / principle 9) ──────────────────────────────────

function TamperAlarm({ atSeq }: { atSeq: number }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        gap: "var(--space-2)",
        alignItems: "flex-start",
        padding: "var(--space-3)",
        margin: "0 0 var(--space-3)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius)",
        border: "var(--border-w) solid var(--danger)",
        boxShadow: "4px 4px 0 0 var(--danger)",
        color: "var(--fg-default)",
        fontSize: "var(--text-sm)",
        lineHeight: "var(--leading-sm)",
      }}
    >
      <span aria-hidden style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }}>
        <ShieldOff size={18} strokeWidth={STROKE} />
      </span>
      <div>
        <div style={{ fontWeight: "var(--weight-bold)", color: "var(--danger)" }}>
          Tamper detected · chain verification failed at v{atSeq}
        </div>
        <div style={{ marginTop: 2, color: "var(--fg-muted)" }}>
          The stored bytes no longer match this version's recorded hash. Reported to admins. This
          cannot be dismissed until resolved.
        </div>
      </div>
    </div>
  );
}

// ── Timeline (the Ledger rail) ─────────────────────────────────────────

function Timeline({
  versions,
  fileId,
  broken,
  sealedCount,
  onRestore,
}: {
  versions: FileVersion[];
  fileId: string;
  broken: number | null;
  sealedCount: number;
  onRestore: (seq: number) => void;
}) {
  const total = versions.length;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: "var(--space-1) 0 0" }}>
      {versions.map((v, i) => {
        const isHead = i === 0;
        const isLast = i === total - 1;
        // Climb runs UP the rail: the oldest (bottom, highest index) seals
        // first. reverseIndex 0 = oldest.
        const reverseIndex = total - 1 - i;
        const sealed = reverseIndex < sealedCount;
        // The node below this one (its predecessor, i+1) — its sealed state
        // fills the connector that climbs from it up toward this node.
        const belowReverseIndex = total - 1 - (i + 1);
        const belowSealed = !isLast && belowReverseIndex < sealedCount;
        // The connector below a node carries the link to its predecessor
        // (the next, lower-seq node). It breaks at the reported seq.
        const linkBroken = broken != null && v.seq === broken;
        return (
          <VersionNode
            key={v.seq}
            v={v}
            fileId={fileId}
            isHead={isHead}
            isLast={isLast}
            sealed={sealed}
            belowSealed={belowSealed}
            linkBroken={linkBroken}
            onRestore={onRestore}
          />
        );
      })}
    </ul>
  );
}

function VersionNode({
  v,
  fileId,
  isHead,
  isLast,
  sealed,
  belowSealed,
  linkBroken,
  onRestore,
}: {
  v: FileVersion;
  fileId: string;
  isHead: boolean;
  isLast: boolean;
  sealed: boolean;
  belowSealed: boolean;
  linkBroken: boolean;
  onRestore: (seq: number) => void;
}) {
  const author = v.author?.name ?? v.author_name ?? "—";
  // Head is always violet (the current chain head); other nodes fill violet
  // as the verify climb seals them.
  const nodeFilled = isHead || sealed;
  return (
    <li style={{ display: "flex", gap: "var(--space-3)" }}>
      {/* Rail — square node + connector (the connector IS the chain link). */}
      <div
        aria-hidden
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
          width: 22,
        }}
      >
        <span
          className={sealed && !isHead ? "vh-node-seal" : undefined}
          style={{
            width: 16,
            height: 16,
            marginTop: 4,
            flexShrink: 0,
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius-2xs)",
            background: nodeFilled ? "var(--violet-500)" : "var(--bg-surface)",
            boxShadow: nodeFilled ? "2px 2px 0 0 var(--shadow-ink)" : "none",
            transition: "background var(--dur) var(--ease)",
          }}
        />
        {!isLast && (
          <span
            style={{
              flex: 1,
              width: linkBroken ? 0 : 3,
              minHeight: 22,
              background: linkBroken
                ? "transparent"
                : belowSealed
                  ? "var(--violet-500)"
                  : "var(--border)",
              borderLeft: linkBroken ? "3px dashed var(--danger)" : "none",
              margin: "3px 0",
              transition: "background var(--dur) var(--ease)",
            }}
          />
        )}
      </div>

      {/* Body — a hard-edged bordered ledger card. */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: "var(--space-3)",
          marginBottom: "var(--space-3)",
          background: "var(--bg-surface)",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <span
            className="mono"
            style={{ fontSize: "var(--mono-sm)", color: "var(--fg-default)", fontWeight: "var(--weight-bold)" }}
          >
            v{v.seq}
          </span>
          {isHead && (
            <span
              className="caps-label"
              style={{
                color: "var(--violet-500)",
                border: "var(--border-w) solid var(--violet-500)",
                background: "var(--violet-100)",
                borderRadius: "var(--radius-xs)",
                padding: "2px 5px",
                fontWeight: "var(--weight-bold)",
              }}
            >
              Current
            </span>
          )}
          {sealed && <SealedChip />}
          {v.held && (
            <StatusChip
              tone="attention"
              icon={<Gavel size={12} strokeWidth={STROKE} />}
              label="hold"
              title="Under an active legal hold"
            />
          )}
          {v.tombstoned && (
            <StatusChip
              tone="ambient"
              icon={<Archive size={12} strokeWidth={STROKE} />}
              label="retained"
              title="Tombstoned — bytes retained, never hidden"
            />
          )}
          <span style={{ flex: 1 }} />
          <span
            className="tnum"
            title={new Date(v.created_at).toLocaleString()}
            style={{ fontSize: "var(--text-xs)", color: "var(--fg-subtle)", whiteSpace: "nowrap" }}
          >
            {relTime(v.created_at)}
          </span>
        </div>

        <div style={{ marginTop: 3, fontSize: "var(--text-xs)", color: "var(--fg-muted)", fontWeight: "var(--weight-medium)" }}>
          {author}
          {v.size > 0 && <> · {formatBytes(v.size)}</>}
        </div>

        {v.reason && (
          <div
            style={{
              marginTop: 4,
              fontSize: "var(--text-sm)",
              color: "var(--fg-default)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {v.reason}
          </div>
        )}

        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <HashChip label="hash" hash={v.content_hash} />
          {v.prev_hash && <HashChip label="prev" hash={v.prev_hash} muted />}
          <span style={{ flex: 1 }} />
          <a
            href={versionContentUrl(fileId, v.seq)}
            download={`v${v.seq}-${downloadName(v)}`}
            className="press-sink"
            style={ghostAction}
            title={`Download v${v.seq}`}
          >
            <Download size={13} strokeWidth={STROKE} aria-hidden />
            Download
          </a>
          {!isHead && (
            <button
              type="button"
              onClick={() => onRestore(v.seq)}
              className="press-sink"
              style={ghostAction}
              title={`Restore v${v.seq} as a new version`}
            >
              <RotateCcw size={13} strokeWidth={STROKE} aria-hidden />
              Restore
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The Stamp — a violet `SEALED` chip that slams in when a row is verified. */
function SealedChip() {
  return (
    <span
      className="vh-stamp"
      title="Link sealed — hash verified against the chain"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        border: "var(--border-w) solid var(--violet-500)",
        background: "var(--violet-100)",
        color: "var(--violet-500)",
        borderRadius: "var(--radius-xs)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-bold)",
        letterSpacing: "var(--tracking-wider)",
        textTransform: "uppercase",
        lineHeight: 1,
        boxShadow: "2px 2px 0 0 var(--violet-500)",
      }}
    >
      <ShieldCheck size={12} strokeWidth={STROKE} aria-hidden />
      Sealed
    </span>
  );
}

/** Truncated, click-to-copy hash. Full value lives in title + aria-label
 *  (§9.5) — never only the truncated visual. */
function HashChip({ label, hash, muted }: { label: string; hash: string; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(hash);
        toast.success("Hash copied");
      }}
      aria-label={`${label} ${hash} — copy`}
      title={`${label}: ${hash}`}
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        background: "var(--bg-sunken)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-xs)",
        fontSize: "var(--mono-xs)",
        fontWeight: "var(--weight-medium)",
        color: muted ? "var(--fg-subtle)" : "var(--fg-default)",
        cursor: "pointer",
      }}
    >
      {label !== "hash" && <span style={{ color: "var(--fg-subtle)" }}>{label}</span>}
      {shortHash(hash)}
      <Copy size={11} strokeWidth={STROKE} aria-hidden style={{ opacity: 0.6 }} />
    </button>
  );
}

// ── States ─────────────────────────────────────────────────────────────

function LoadingTimeline() {
  return (
    <div style={{ paddingTop: "var(--space-2)" }} aria-busy="true" aria-label="Loading versions">
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonRow key={i} columns={4} />
      ))}
    </div>
  );
}

function OneVersion() {
  return (
    <div style={emptyBox}>
      <RegistryMotif overlay="layers" />
      <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--fg-default)" }}>
        One version so far
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", maxWidth: 280 }}>
        History begins here. Every save appends a new, hash-chained version you can verify, restore,
        and download.
      </div>
    </div>
  );
}

function EmptyChain() {
  return (
    <div style={emptyBox}>
      <RegistryMotif overlay="scroll-text" />
      <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--fg-default)" }}>
        No versions yet
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)", maxWidth: 280 }}>
        This document's version chain is empty. It fills in as the file is saved.
      </div>
    </div>
  );
}

function Footer({ count, verified }: { count: number; verified: boolean }) {
  return (
    <footer
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        marginTop: "var(--space-1)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-medium)",
        color: "var(--fg-muted)",
        background: "var(--bg-surface)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
      }}
    >
      <span className="tnum" style={{ fontWeight: "var(--weight-bold)", color: "var(--fg-default)" }}>{count}</span>
      <span>{count === 1 ? "version" : "versions"}</span>
      <span>·</span>
      {verified ? (
        <StatusChip
          tone="verified"
          icon={<ShieldCheck size={12} strokeWidth={STROKE} />}
          label="chain intact"
        />
      ) : (
        <StatusChip
          tone="danger"
          icon={<ShieldOff size={12} strokeWidth={STROKE} />}
          label="chain broken"
        />
      )}
      <span style={{ flex: 1 }} />
      <span>Append-only · hash-chained</span>
    </footer>
  );
}

// ── helpers ────────────────────────────────────────────────────────────

const errBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "var(--space-2)",
  margin: "0 0 var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--bg-surface)",
  border: "var(--border-w) solid var(--danger)",
  borderRadius: "var(--radius)",
  fontSize: "var(--text-sm)",
  color: "var(--fg-default)",
};

const errRetryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  border: "var(--border-w) solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--ink)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  cursor: "pointer",
};

const emptyBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  margin: "var(--space-2) 0",
  padding: "var(--space-8) var(--space-4)",
  textAlign: "center",
  background: "var(--bg-surface)",
  border: "var(--border-w) solid var(--border)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow)",
};

function verifyBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    padding: "9px 14px",
    borderRadius: "var(--radius-sm)",
    border: "var(--border-w) solid var(--border)",
    background: "var(--violet-500)",
    color: "var(--on-violet)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: "var(--weight-bold)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

const ghostAction: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 9px",
  borderRadius: "var(--radius-sm)",
  border: "var(--border-w) solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--fg-default)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-xs)",
  fontWeight: "var(--weight-bold)",
  textDecoration: "none",
  cursor: "pointer",
};

function shortHash(h: string): string {
  if (h.length <= 8) return h;
  return `${h.slice(0, 4)}…${h.slice(-2)}`;
}

function downloadName(v: FileVersion): string {
  return v.content_hash ? `${v.content_hash.slice(0, 8)}` : `seq${v.seq}`;
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m ago`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h ago`;
  if (abs < 7 * 86_400_000) return `${Math.round(abs / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
