/**
 * Bottom-docked selection bar. Spec: docs/ux/09-sort-and-select.md.
 *
 * Renders when count >= 1, slides up on appear / down on dismiss. Owns
 * its bulk-trash confirmation flow internally so the parent doesn't have
 * to track a modal state for it.
 */
import { useState } from "react";
import { Download, FolderInput, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "./ConfirmDialog.tsx";

export function SelectionBar({
  count,
  onClear,
  onDownload,
  onTrash,
}: {
  count: number;
  onClear: () => void;
  onDownload: () => void;
  onTrash: () => Promise<void>;
}) {
  const [trashing, setTrashing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function performTrash() {
    setTrashing(true);
    try {
      await onTrash();
    } catch {
      toast.error("Couldn't trash some files.");
    } finally {
      setTrashing(false);
    }
  }

  function handleTrash() {
    if (trashing) return;
    if (count > 5) {
      setConfirming(true);
      return;
    }
    void performTrash();
  }

  return (
    <div
      role="region"
      aria-label={`${count} item${count === 1 ? "" : "s"} selected`}
      style={{
        position: "fixed",
        left: "50%",
        bottom: 26,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px 10px 18px",
        background: "var(--bg-surface)",
        color: "var(--ink)",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 50,
        animation: "cd-selbar-in 220ms var(--ease)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
      }}
    >
      <span className="tabular-nums" style={{ minWidth: 80 }}>
        {count} selected
      </span>

      <button
        type="button"
        className="press-sink"
        onClick={onClear}
        aria-label="Clear selection"
        style={iconBtn()}
        onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
        title="Clear selection (Esc)"
      >
        <X size={14} strokeWidth={1.8} />
      </button>

      <Sep />

      <ActionBtn onClick={onDownload}>
        <Download size={14} strokeWidth={1.8} />
        Download
      </ActionBtn>
      <ActionBtn
        onClick={() =>
          toast.info("Move is coming in v0.2.", {
            description: "Folder-picker modal lands alongside multi-folder ops.",
          })
        }
      >
        <FolderInput size={14} strokeWidth={1.8} />
        Move
      </ActionBtn>
      <ActionBtn onClick={() => handleTrash()} danger disabled={trashing}>
        <Trash2 size={14} strokeWidth={1.8} />
        {trashing ? "Trashing…" : "Trash"}
      </ActionBtn>

      <ConfirmDialog
        open={confirming}
        title={`Move ${count} ${count === 1 ? "file" : "files"} to trash?`}
        body="Items in Trash can be restored for 30 days, then they're permanently removed."
        confirmLabel="Move to trash"
        variant="destructive"
        onConfirm={performTrash}
        onClose={() => setConfirming(false)}
      />

      <style>{`
        @keyframes cd-selbar-in {
          from { opacity: 0; transform: translate(-50%, 14px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

function Sep() {
  return <span style={{ width: "var(--border-w)", height: 20, background: "var(--border)", margin: "0 4px" }} />;
}

function ActionBtn({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="press-sink"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        color: danger ? "var(--danger)" : "var(--ink)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = danger ? "var(--bg-sunken)" : "var(--bg-hover)";
        }
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function iconBtn(): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: "var(--radius-sm)",
    background: "transparent",
    border: "none",
    color: "var(--ink)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
