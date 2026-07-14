/**
 * NT4 — `+` note-link popover. Renders matching notes + an optional
 * "Create page «query»" footer when the query doesn't exactly match.
 */
import { useCallback, useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { FileText, Plus } from "lucide-react";

import type { NoteLinkItem } from "./noteLink.ts";

export interface NoteLinkPopoverHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
  update: (state: {
    items: NoteLinkItem[];
    clientRect: (() => DOMRect | null) | null;
    command: (item: NoteLinkItem | "create") => void;
    createDraft: string | null;
  }) => void;
  hide: () => void;
}

interface RenderedState {
  items: NoteLinkItem[];
  clientRect: (() => DOMRect | null) | null;
  command: (item: NoteLinkItem | "create") => void;
  createDraft: string | null;
}

interface Props {
  /** Handler when the user picks "Create page «query»". Creates the note and
   * resolves to the new note's {id,title} WITHOUT navigating away — the popover
   * then inserts a real link to it at the caret. Resolves null on failure. */
  onCreateNote?: (title: string) => Promise<NoteLinkItem | null>;
}

export const NoteLinkPopover = forwardRef<NoteLinkPopoverHandle, Props>(
  function NoteLinkPopover({ onCreateNote }, ref) {
    const [state, setState] = useState<RenderedState | null>(null);
    const [highlighted, setHighlighted] = useState(0);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    const visibleCount =
      (state?.items.length ?? 0) + (state?.createDraft ? 1 : 0);

    useEffect(() => {
      if (!state?.clientRect) {
        setPos(null);
        return;
      }
      const rect = state.clientRect();
      if (!rect) return;
      setPos({ left: rect.left, top: rect.bottom + 6 });
    }, [state]);

    useEffect(() => {
      setHighlighted(0);
    }, [state?.items, state?.createDraft]);

    const pick = useCallback(
      (index: number) => {
        if (!state) return;
        if (index < state.items.length) {
          state.command(state.items[index]);
        } else if (state.createDraft) {
          // Create the note, then insert a real link to it via the same
          // extension command used for existing notes (it deletes the typed
          // `+query` trigger and inserts the link mark). The editor content is
          // unchanged during creation, so the captured range stays valid. On
          // failure we still run `create` to clean up the stray `+query` text.
          const draft = state.createDraft;
          const cmd = state.command;
          setState(null);
          void (async () => {
            const created = await onCreateNote?.(draft);
            if (created) cmd(created);
            else cmd("create");
          })();
        }
      },
      [state, onCreateNote],
    );

    useImperativeHandle(
      ref,
      () => ({
        update: (s) => setState(s),
        hide: () => setState(null),
        onKeyDown: (e: KeyboardEvent) => {
          if (!state || visibleCount === 0) return false;
          if (e.key === "ArrowDown") {
            setHighlighted((i) => (i + 1) % visibleCount);
            return true;
          }
          if (e.key === "ArrowUp") {
            setHighlighted((i) => (i - 1 + visibleCount) % visibleCount);
            return true;
          }
          if (e.key === "Enter") {
            pick(highlighted);
            return true;
          }
          if (e.key === "Escape") {
            setState(null);
            return true;
          }
          return false;
        },
      }),
      [state, highlighted, pick, visibleCount],
    );

    if (!state || !pos || visibleCount === 0) return null;

    return (
      <div
        className="cd-mention-menu"
        role="listbox"
        aria-label="Link to a note"
        style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 70 }}
      >
        {state.items.map((n, i) => (
          <button
            key={n.id}
            type="button"
            role="option"
            aria-selected={i === highlighted}
            className={`cd-mention-item${i === highlighted ? " is-active" : ""}`}
            onMouseEnter={() => setHighlighted(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(i)}
          >
            <span className="cd-mention-avatar cd-mention-avatar--note">
              <FileText size={12} strokeWidth={1.8} />
            </span>
            <span className="cd-mention-body">
              <span className="cd-mention-name">{n.title}</span>
            </span>
          </button>
        ))}
        {state.createDraft && (
          <button
            type="button"
            role="option"
            aria-selected={highlighted === state.items.length}
            className={`cd-mention-item cd-mention-create${
              highlighted === state.items.length ? " is-active" : ""
            }`}
            onMouseEnter={() => setHighlighted(state.items.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(state.items.length)}
          >
            <span className="cd-mention-avatar cd-mention-avatar--create">
              <Plus size={12} strokeWidth={2} />
            </span>
            <span className="cd-mention-body">
              <span className="cd-mention-name">Create page "{state.createDraft}"</span>
            </span>
          </button>
        )}
      </div>
    );
  },
);
