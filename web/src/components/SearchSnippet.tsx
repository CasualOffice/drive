import React from "react";

/**
 * Render a content-search snippet with the matched terms highlighted in
 * the violet signal color (neobrutalist — bold, no glow, no blur).
 *
 * Two highlight paths:
 *  - **Server-highlighted:** the backend wraps matches in `<mark>…</mark>`
 *    (Tantivy highlighting). We split on those spans and mark them.
 *  - **Client-highlighted fallback:** no `<mark>` in the snippet → we mark
 *    occurrences of the query terms ourselves.
 *
 * Snippets are rendered as plain React text nodes — never `innerHTML` — so
 * a document's own text can't inject markup into the UI.
 */
export function SearchSnippet({
  snippet,
  query,
  testid,
}: {
  snippet: string;
  query: string;
  testid?: string;
}) {
  const segments = parseSnippet(snippet, query);
  return (
    <span
      data-testid={testid}
      style={{
        display: "block",
        fontSize: "var(--text-xs)",
        color: "var(--fg-muted)",
        lineHeight: 1.5,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      {segments.map((seg, i) =>
        seg.mark ? (
          <mark
            key={i}
            style={{
              background: "transparent",
              color: "var(--violet-500)",
              fontWeight: 700,
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </span>
  );
}

interface Segment {
  text: string;
  mark: boolean;
}

function parseSnippet(snippet: string, query: string): Segment[] {
  // Server-highlighted path — split on <mark>…</mark>, stripping any other
  // stray tags so raw markup never renders.
  if (/<mark>/i.test(snippet)) {
    const segs: Segment[] = [];
    const re = /<mark>([\s\S]*?)<\/mark>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(snippet)) !== null) {
      if (m.index > last) {
        segs.push({ text: stripTags(snippet.slice(last, m.index)), mark: false });
      }
      segs.push({ text: stripTags(m[1]), mark: true });
      last = re.lastIndex;
    }
    if (last < snippet.length) {
      segs.push({ text: stripTags(snippet.slice(last)), mark: false });
    }
    return segs.filter((s) => s.text.length > 0);
  }

  // Client-highlight fallback — mark occurrences of the query terms.
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map(escapeRegExp);
  if (terms.length === 0) return [{ text: snippet, mark: false }];

  const re = new RegExp(`(${terms.join("|")})`, "gi");
  const segs: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) segs.push({ text: snippet.slice(last, m.index), mark: false });
    segs.push({ text: m[0], mark: true });
    last = re.lastIndex;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
  }
  if (last < snippet.length) segs.push({ text: snippet.slice(last), mark: false });
  return segs.filter((s) => s.text.length > 0);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
