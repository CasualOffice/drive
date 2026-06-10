/**
 * NT2 Phase 2 — link dialog.
 *
 * Tiny Radix-backed dialog with a single URL field. Wraps the user's
 * current selection as a link (or, when the cursor is inside an
 * existing link, prefills the URL + offers a "Remove" button).
 *
 * Validation:
 *   - Allow http/https/mailto/tel up front.
 *   - Bare host (no scheme) gets `https://` prepended automatically.
 *   - Reject `javascript:` + `data:` outright — both are XSS vectors
 *     and there's no reason a note ever needs them.
 *   - Trim whitespace; reject empty.
 *
 * Markdown round-trip: Tiptap's Link mark serializes to `[text](url)`
 * via tiptap-markdown, which is exactly what the existing share-link
 * markdown renderer expects. No storage migration.
 */
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link as LinkIcon, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  /** URL prefilled in the input. Empty when adding a fresh link;
   * populated when the cursor sits inside an existing link mark. */
  initialUrl: string;
  /** True when the user is editing an existing link (shows Remove). */
  editing: boolean;
  /** Called with the validated URL when the user applies. */
  onApply: (url: string) => void;
  /** Called when the user clicks Remove (only meaningful when
   * `editing`). */
  onRemove?: () => void;
  onClose: () => void;
}

const ALLOWED_SCHEMES = ["http:", "https:", "mailto:", "tel:"];
const BLOCKED_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"];

export function LinkDialog({
  open,
  initialUrl,
  editing,
  onApply,
  onRemove,
  onClose,
}: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, initialUrl]);

  function submit() {
    const cleaned = normalizeUrl(url);
    if (cleaned.error) {
      setError(cleaned.error);
      return;
    }
    onApply(cleaned.url);
    onClose();
  }

  function remove() {
    onRemove?.();
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="cd-dialog-overlay" />
        <Dialog.Content
          className="cd-dialog-content"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          <div className="cd-dialog-header">
            <span className="cd-dialog-icon" aria-hidden="true">
              <LinkIcon size={15} strokeWidth={1.8} />
            </span>
            <Dialog.Title className="cd-dialog-title">
              {editing ? "Edit link" : "Add link"}
            </Dialog.Title>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label
              htmlFor="cd-link-input"
              style={{
                display: "block",
                fontSize: "var(--text-xs)",
                color: "var(--muted)",
                marginBottom: 6,
                letterSpacing: "0.04em",
              }}
            >
              URL
            </label>
            <input
              ref={inputRef}
              id="cd-link-input"
              type="text"
              className="cd-dialog-input"
              placeholder="https://example.com"
              value={url}
              aria-invalid={error !== null || undefined}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && (
              <div
                role="alert"
                style={{ marginTop: 6, fontSize: "var(--text-xs)", color: "var(--danger)" }}
              >
                {error}
              </div>
            )}
            <div className="cd-dialog-actions">
              {editing && (
                <button
                  type="button"
                  className="cd-dialog-btn cd-dialog-btn--ghost"
                  onClick={remove}
                  style={{ marginRight: "auto", color: "var(--danger)" }}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                  &nbsp;Remove
                </button>
              )}
              <button
                type="button"
                className="cd-dialog-btn cd-dialog-btn--ghost"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cd-dialog-btn cd-dialog-btn--primary"
                disabled={url.trim().length === 0}
              >
                {editing ? "Update" : "Add link"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface Normalized {
  url: string;
  error: string | null;
}

/** Trim + scheme-validate + auto-prepend `https://` for bare hosts. */
export function normalizeUrl(raw: string): Normalized {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { url: "", error: "URL is required" };

  // Reject explicit dangerous schemes upfront. Case-insensitive — the
  // spec lets `JaVaScRiPt:` slip past a naive .startsWith check.
  const lower = trimmed.toLowerCase();
  if (BLOCKED_SCHEMES.some((s) => lower.startsWith(s))) {
    return { url: "", error: "That URL scheme isn't allowed" };
  }

  // If it already has a recognised scheme, accept as-is. Otherwise
  // assume the user typed a bare host (`example.com`, `foo.com/bar`)
  // and prepend `https://`.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  // Validate via URL constructor.
  try {
    const u = new URL(candidate);
    if (!ALLOWED_SCHEMES.includes(u.protocol)) {
      return { url: "", error: `Unsupported scheme ${u.protocol}` };
    }
    return { url: candidate, error: null };
  } catch {
    return { url: "", error: "Not a valid URL" };
  }
}
