/**
 * Small Radix-backed rename dialog. One field, validates name length,
 * Enter to save, Esc to cancel.
 *
 * The parent owns the persistence call (so the same dialog handles
 * folders, files, and — later — share-link descriptions).
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function RenameDialog({
  open,
  current,
  label,
  onClose,
  onSubmit,
}: {
  open: boolean;
  current: string;
  label: string;
  onClose: () => void;
  onSubmit: (newName: string) => Promise<void>;
}) {
  const [name, setName] = useState(current);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setName(current);
      setError(null);
      setSubmitting(false);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        // Select the basename (everything before the last extension dot) so
        // the user can immediately overwrite the name without nuking the .ext.
        const dot = current.lastIndexOf(".");
        if (dot > 0 && dot < current.length - 1) {
          input.setSelectionRange(0, dot);
        } else {
          input.select();
        }
      });
    }
  }, [open, current]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    if (trimmed === current) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError((e as Error)?.message ?? "Couldn't save.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--bg-overlay)",
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-fade-in 200ms var(--ease)",
          }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(440px, 92vw)",
            background: "var(--bg-surface)",
            border: "var(--border-w) solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "24px 26px 22px",
            boxShadow: "var(--shadow-lg)",
            zIndex: "var(--z-modal)" as unknown as number,
            animation: "cd-modal-in 240ms var(--ease)",
          }}
        >
          <Dialog.Title
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-xl)",
              fontWeight: 500,
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink)",
            }}
          >
            Rename {label.toLowerCase()}
          </Dialog.Title>
          <Dialog.Description
            style={{ marginTop: 4, marginBottom: 18, fontSize: "var(--text-sm)", color: "var(--muted)" }}
          >
            Press <kbd style={kbd()}>Enter</kbd> to save · <kbd style={kbd()}>Esc</kbd> to cancel.
          </Dialog.Description>

          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            disabled={submitting}
            spellCheck={false}
            style={{
              display: "block",
              width: "100%",
              padding: "11px 13px",
              border: `1px solid ${error ? "var(--danger)" : "var(--line-strong)"}`,
              borderRadius: 11,
              background: "var(--paper)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              color: "var(--ink)",
              outline: "none",
              transition: "border-color 150ms, box-shadow 150ms",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--ink)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(15, 23, 42,.08)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--line-strong)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
          {error && (
            <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--danger)" }}>{error}</div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={onClose} disabled={submitting} style={ghostBtn()}>
              Cancel
            </button>
            <button type="button" onClick={() => void submit()} disabled={submitting} style={primaryBtn(submitting)}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function kbd(): React.CSSProperties {
  return {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11,
    background: "var(--bg-subtle)",
    border: "1px solid var(--line)",
    borderRadius: 5,
    padding: "1px 6px",
    color: "var(--muted)",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: "9px 14px",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "var(--paper)",
    color: "var(--ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
  };
}

function primaryBtn(submitting: boolean): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 10,
    border: "none",
    background: submitting ? "var(--line-strong)" : "var(--ink)",
    color: "var(--paper)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: submitting ? "not-allowed" : "pointer",
  };
}
