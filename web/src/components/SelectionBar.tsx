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
        background: "var(--ink)",
        color: "var(--paper)",
        borderRadius: 14,
        boxShadow: "0 12px 30px rgba(15, 23, 42, 0.30)",
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
        onClick={onClear}
        aria-label="Clear selection"
        style={iconBtn()}
        onMouseOver={(e) => (e.currentTarget.style.background = "rgba(232, 237, 242,.10)")}
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
  return <span style={{ width: 1, height: 20, background: "rgba(232, 237, 242,.18)", margin: "0 4px" }} />;
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
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 9,
        background: danger ? "rgba(220, 38, 38,.20)" : "rgba(232, 237, 242,.06)",
        color: danger ? "#FFB3B3" : "var(--paper)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: 500,
        opacity: disabled ? 0.6 : 1,
        transition: "background 150ms, transform 150ms",
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = danger ? "rgba(220, 38, 38,.32)" : "rgba(232, 237, 242,.12)";
          e.currentTarget.style.transform = "translateY(-1px)";
        }
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = danger ? "rgba(220, 38, 38,.20)" : "rgba(232, 237, 242,.06)";
        e.currentTarget.style.transform = "";
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
    borderRadius: 8,
    background: "transparent",
    border: "none",
    color: "var(--paper)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 150ms",
  };
}
