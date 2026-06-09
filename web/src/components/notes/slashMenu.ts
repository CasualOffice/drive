/**
 * NT3 — slash menu (block insertion).
 * Spec: docs/research/17-notes-general-user-ux.md §"Slash menu".
 *
 * Type `/` at the start of an empty line OR after whitespace; a popover
 * lists insertable blocks. Arrow keys + Enter to pick; Esc closes.
 * Never auto-opens. Power users keep their markdown shortcuts.
 *
 * Phase 2 follow-ups (in PIPELINE):
 *   - "Embed file from Drive" item (NT7 — note attachments).
 *   - "Link to note" item (NT4 picker — distinct from `+`/`[[` triggers).
 *   - `/ask AI` items (path-only seam — wired when user prioritises).
 */
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/core";

// Distinct key per Suggestion extension — Tiptap's @tiptap/suggestion
// defaults all plugins to the same `suggestion$` key, so when an
// editor mounts three Suggestion extensions (slash / @-mention /
// +-note-link) they collide with "Adding different instances of a
// keyed plugin (suggestion$)". Each extension exports its own key
// so ProseMirror can track them as siblings.
export const slashMenuPluginKey = new PluginKey("slashMenuSuggestion");

export interface SlashItem {
  id: string;
  title: string;
  description?: string;
  /** Keywords for the filter — typed letters narrow the list. */
  keywords: string[];
  run: (args: { editor: Editor; range: Range }) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Large section title",
    keywords: ["heading", "h1", "title", "#"],
    // `toggleHeading` is the Heading extension's native command and is
    // more reliable than `setNode("heading", …)` because it handles
    // the paragraph→heading transform + attribute set in one step.
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section title",
    keywords: ["heading", "h2", "subtitle", "##"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section title",
    keywords: ["heading", "h3", "###"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    id: "ul",
    title: "Bullet list",
    description: "Simple bulleted list",
    keywords: ["bullet", "list", "ul", "unordered", "-"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "ol",
    title: "Numbered list",
    description: "Ordered list 1, 2, 3…",
    keywords: ["numbered", "ordered", "ol", "list", "1."],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "quote",
    title: "Quote",
    description: "Block quotation",
    keywords: ["quote", "blockquote", ">"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: "code",
    title: "Code block",
    description: "Monospace code, no formatting",
    keywords: ["code", "pre", "```"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: "hr",
    title: "Divider",
    description: "Horizontal rule",
    keywords: ["divider", "hr", "rule", "---"],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

/** Filter slash items by the user's query (case-insensitive substring
 * over title + keywords). Empty query returns the whole list in order. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((k) => k.toLowerCase().includes(q));
  });
}

export interface SlashRendererControls {
  /** Called when the popover should appear/move/refilter. */
  onUpdate: (state: {
    items: SlashItem[];
    query: string;
    clientRect: (() => DOMRect | null) | null;
    command: (item: SlashItem) => void;
  }) => void;
  /** Called when the popover should close. */
  onExit: () => void;
  /** Forward a keydown to the popover so it can move selection or
   * pick an item with Enter. Return true if the event was handled. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** Tiptap extension that registers the `/` suggestion trigger. Pass a
 * controls object hooked up to a React popover that paints the items. */
export function slashMenuExtension(controls: SlashRendererControls): Extension {
  const suggestion: Omit<SuggestionOptions, "editor"> = {
    pluginKey: slashMenuPluginKey,
    char: "/",
    // Only allow `/` to trigger at the start of a node OR after whitespace —
    // mid-word slashes (file paths, URLs) shouldn't open the menu.
    allowSpaces: false,
    startOfLine: false,
    items: ({ query }) => filterSlashItems(query),
    command: ({ editor, range, props }) => {
      (props as SlashItem).run({ editor, range });
    },
    render: () => ({
      onStart: (props) => {
        controls.onUpdate({
          items: props.items as SlashItem[],
          query: props.query,
          clientRect: props.clientRect ?? null,
          command: props.command as (item: SlashItem) => void,
        });
      },
      onUpdate: (props) => {
        controls.onUpdate({
          items: props.items as SlashItem[],
          query: props.query,
          clientRect: props.clientRect ?? null,
          command: props.command as (item: SlashItem) => void,
        });
      },
      onKeyDown: (props) => controls.onKeyDown(props.event),
      onExit: () => controls.onExit(),
    }),
  };

  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...suggestion,
        }),
      ];
    },
  });
}
