/**
 * NT2 — floating formatting toolbar.
 * Spec: docs/research/17-notes-general-user-ux.md §"Floating formatting toolbar".
 *
 * Shows above the user's text selection. Tiptap's `BubbleMenu` extension
 * positions it via floating-ui; we render a token-styled row of icon
 * buttons inside.
 *
 * Phase 2 follow-ups (still pending):
 *   - "Turn into → ..." sub-menu for converting between block types.
 */
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Strikethrough,
  Code as CodeIcon,
  Link as LinkIcon,
  Quote,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";

interface Props {
  editor: Editor | null;
  /** Opens the link dialog (NT2 Phase 2). Hoisted into the parent so
   * the dialog state can be shared with the mobile toolbar. */
  onLinkClick: () => void;
}

export function FormattingToolbar({ editor, onLinkClick }: Props) {
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      // Hide on empty selection or inside code-block (markdown shortcuts
      // there would be a footgun).
      shouldShow={({ editor, from, to }) => {
        if (from === to) return false;
        if (editor.isActive("codeBlock")) return false;
        return true;
      }}
      options={{
        placement: "top",
        offset: 8,
      }}
    >
      <div className="cd-bubble-toolbar" role="toolbar" aria-label="Format selection">
        <Btn
          label="Bold"
          shortcut="⌘B"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <BoldIcon size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Italic"
          shortcut="⌘I"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Inline code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <CodeIcon size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label={editor.isActive("link") ? "Edit link" : "Add link"}
          shortcut="⌘K"
          active={editor.isActive("link")}
          onClick={onLinkClick}
        >
          <LinkIcon size={14} strokeWidth={2} />
        </Btn>
        <Sep />
        <Btn
          label="Heading 1"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={14} strokeWidth={2} />
        </Btn>
        <Sep />
        <Btn
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={14} strokeWidth={2} />
        </Btn>
        <Btn
          label="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={14} strokeWidth={2} />
        </Btn>
      </div>
    </BubbleMenu>
  );
}

function Btn({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      title={shortcut ? `${label} · ${shortcut}` : label}
      onMouseDown={(e) => {
        // Prevent the selection from collapsing before the command runs.
        e.preventDefault();
      }}
      onClick={onClick}
      className={`cd-bubble-btn${active ? " is-active" : ""}`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="cd-bubble-sep" />;
}
