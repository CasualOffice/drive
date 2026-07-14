/**
 * NT6 Phase 1 — mobile sticky toolbar.
 * Spec: docs/research/17-notes-general-user-ux.md §"Mobile".
 *
 * Sits at the bottom of the viewport when the editor has focus on
 * mobile (≤1023 px). Renders the most-used format actions + a slash
 * trigger that opens the block menu. Always visible above the
 * keyboard while typing — `position: fixed; bottom: 0;` with safe-area
 * padding for notched iPhones.
 *
 * Phase 2 (separate PIPELINE row): long-press on a block opens a
 * bottom sheet with the block menu (Duplicate / Move / Turn into /
 * Delete). That sheet is the mobile analogue of NT5's drag-handle
 * menu, hence Phase 2 since the two share design surface.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  List,
  Heading as HeadingIcon,
  Link as LinkIcon,
  Slash,
} from "lucide-react";

interface Props {
  editor: Editor | null;
  /** Opens the link dialog (NT2 Phase 2). Same handler as the bubble
   * toolbar — dialog state is hoisted into MarkdownEditor. */
  onLinkClick: () => void;
}

export function MobileToolbar({ editor, onLinkClick }: Props) {
  // Track focus so the toolbar shows only while the user is editing.
  // Tiptap exposes `editor.isFocused` plus `focus` / `blur` events.
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const onFocus = () => setFocused(true);
    const onBlur = () => {
      // Defer the hide so a tap on the toolbar (which transiently
      // blurs the editor) doesn't flicker the bar away.
      setTimeout(() => setFocused(false), 80);
    };
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  if (!editor || !focused) return null;

  // Heading cycle: paragraph → H1 → H2 → H3 → paragraph.
  const cycleHeading = () => {
    if (editor.isActive("heading", { level: 1 })) {
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    } else if (editor.isActive("heading", { level: 2 })) {
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    } else if (editor.isActive("heading", { level: 3 })) {
      editor.chain().focus().setNode("paragraph").run();
    } else {
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    }
  };

  // Slash button programmatically inserts `/` so the existing suggestion
  // plugin opens the menu. That plugin only triggers at block-start or right
  // after whitespace, so if the caret sits after a non-space character we
  // prepend a space — otherwise the tap just drops a literal "/" and the menu
  // never opens.
  const openSlash = () => {
    const { $from, empty } = editor.state.selection;
    const charBefore = empty
      ? $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset)
      : "";
    const needsSpace = charBefore !== "" && !/\s/.test(charBefore);
    editor
      .chain()
      .focus()
      .insertContent(needsSpace ? " /" : "/")
      .run();
  };

  const headingLevel = editor.isActive("heading", { level: 1 })
    ? "1"
    : editor.isActive("heading", { level: 2 })
      ? "2"
      : editor.isActive("heading", { level: 3 })
        ? "3"
        : null;

  return (
    <div role="toolbar" aria-label="Mobile editor toolbar" className="cd-mobile-toolbar">
      <MobBtn
        label="Bold"
        active={editor.isActive("bold")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
      >
        <BoldIcon size={17} strokeWidth={2} />
      </MobBtn>
      <MobBtn
        label="Italic"
        active={editor.isActive("italic")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <ItalicIcon size={17} strokeWidth={2} />
      </MobBtn>
      <MobBtn
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBulletList().run();
        }}
      >
        <List size={17} strokeWidth={2} />
      </MobBtn>
      <MobBtn
        label={headingLevel ? `Heading ${headingLevel} (tap to cycle)` : "Heading"}
        active={headingLevel !== null}
        onMouseDown={(e) => {
          e.preventDefault();
          cycleHeading();
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <HeadingIcon size={17} strokeWidth={2} />
          {headingLevel && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent-strong)" }}>
              {headingLevel}
            </span>
          )}
        </span>
      </MobBtn>
      <MobBtn
        label={editor.isActive("link") ? "Edit link" : "Add link"}
        active={editor.isActive("link")}
        onMouseDown={(e) => {
          e.preventDefault();
          onLinkClick();
        }}
      >
        <LinkIcon size={17} strokeWidth={2} />
      </MobBtn>
      <span className="cd-mobile-sep" aria-hidden="true" />
      <MobBtn
        label="Insert block (slash menu)"
        active={false}
        onMouseDown={(e) => {
          e.preventDefault();
          openSlash();
        }}
      >
        <Slash size={17} strokeWidth={2} />
      </MobBtn>
    </div>
  );
}

function MobBtn({
  label,
  active,
  onMouseDown,
  children,
}: {
  label: string;
  active: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={onMouseDown}
      onTouchStart={(e) => {
        // Mirror the mousedown semantics on touch so the selection
        // doesn't collapse before the command runs.
        e.preventDefault();
        onMouseDown(e as unknown as React.MouseEvent);
      }}
      className={`cd-mobile-btn${active ? " is-active" : ""}`}
    >
      {children}
    </button>
  );
}
