/**
 * Per-type stage renderer for the document preview surface. Spec:
 * docs/ux/07-preview-surface.md + docs/design/ui-system.md (§7 preview,
 * §7.13 skeletons). Doc-Hub is documents-only — there is no image, video
 * or audio renderer here; those extensions never pass ingest.
 *
 * Picks the right primitive for the file kind:
 *   - pdf   → <iframe> (browser-native viewer), on the user-content CSP
 *   - text  → <pre> after a capped text fetch; mono for csv/json/yaml,
 *             a readable prose measure for txt
 *   - md    → marked + DOMPurify-sanitised HTML, readable measure
 *   - doc   → embedded Casual Docs (read-only handoff)
 *   - sheet → embedded Casual Sheet (read-only handoff)
 *   - opaque (xlsm/pptx) / fold / generic → document glyph + Download
 *
 * All bytes come from the file's existing downloadUrl which 302s to the
 * signed URL on the user-content origin.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { AlertTriangle, Download, ScrollText } from "lucide-react";

import type { UseFileSourceAutoSaveReturn } from "@casualoffice/docs";

import { downloadUrl, type FileDto } from "../../api/client.ts";
import { FileThumb, inferKind, type FileKind } from "../FileThumb.tsx";

// CasualDocEditor + CasualSheetWorkspace pull the editor SDK + the Univer
// peer set (collectively ~2.5 MB minified). Defer them behind React.lazy so
// the vendor chunk only downloads when a user actually clicks into a
// .docx / .xlsx preview — the cold-load stays small.
const CasualDocEditor = lazy(() =>
  import("../editor/CasualDocEditor.tsx").then((m) => ({ default: m.CasualDocEditor })),
);
const CasualSheetWorkspace = lazy(() =>
  import("../editor/CasualSheetWorkspace.tsx").then((m) => ({
    default: m.CasualSheetWorkspace,
  })),
);

const TEXT_CAP_BYTES = 512 * 1024; // 512 KB
const MD_CAP_BYTES = 256 * 1024; // 256 KB

/** Text kinds that read better as prose (sans, constrained measure) than
 *  as monospaced code. Everything else on the `text` kind (csv/json/yaml/
 *  log/source) renders mono. */
function isProseText(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "txt" || ext === "text";
}

export interface PreviewStageProps {
  file: FileDto;
  kind: FileKind;
  /** Carried for API stability — autosave state now lives INSIDE the
   *  embed iframe (the SDK's own chrome shows "Saving…"), so the
   *  modal no longer subscribes. Drop this prop in the next major. */
  onAutosaveState?: (state: UseFileSourceAutoSaveReturn) => void;
}

export function PreviewStage({ file, kind }: PreviewStageProps) {
  switch (kind) {
    case "pdf":
      return <PdfStage file={file} />;
    case "text":
      return <TextStage file={file} cap={TEXT_CAP_BYTES} prose={isProseText(file.name)} />;
    case "md":
      return <MarkdownStage file={file} />;
    case "doc":
      return (
        <Suspense fallback={<PreviewSkeleton />}>
          {/* mode='preview' hides the toolbar inside the iframe so the
              stage renders JUST the document canvas. */}
          <ErrorAwareDoc file={file} />
        </Suspense>
      );
    case "sheet":
      return (
        <Suspense fallback={<PreviewSkeleton />}>
          <ErrorAwareSheet file={file} />
        </Suspense>
      );
    default:
      // fold / generic / opaque (xlsm, pptx) — and, defensively, any
      // img/vid/aud that slipped past ingest — get the document glyph
      // with a Download. No media renderer exists on this surface.
      return <GlyphFallback file={file} kind={kind} />;
  }
}

// ── PDF ────────────────────────────────────────────────────────────────

function PdfStage({ file }: { file: FileDto }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ErrorState file={file} />;
  return (
    <div style={{ width: "100%", height: "100%", background: "var(--bg-canvas)" }}>
      <iframe
        src={`${downloadUrl(file.id)}#view=FitH`}
        title={file.name}
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      />
    </div>
  );
}

// ── Text + Markdown ────────────────────────────────────────────────────

interface TextLoad {
  state: "loading" | "ready" | "error";
  body?: string;
  truncated?: boolean;
  error?: string;
}

function useCappedText(file: FileDto, cap: number): TextLoad {
  const [load, setLoad] = useState<TextLoad>({ state: "loading" });
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    setLoad({ state: "loading" });
    (async () => {
      try {
        const res = await fetch(downloadUrl(file.id), { credentials: "same-origin" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // For demo-mode blob: URLs we still want to honour the cap.
        const blob = await res.blob();
        const truncated = blob.size > cap;
        const slice = truncated ? blob.slice(0, cap) : blob;
        const text = await slice.text();
        if (seq.current === my) setLoad({ state: "ready", body: text, truncated });
      } catch (e) {
        if (seq.current === my) setLoad({ state: "error", error: (e as Error).message });
      }
    })();
  }, [file.id, cap]);
  return load;
}

function TextStage({ file, cap, prose }: { file: FileDto; cap: number; prose: boolean }) {
  const load = useCappedText(file, cap);
  if (load.state === "loading") return <PreviewSkeleton lines />;
  if (load.state === "error") return <ErrorState file={file} />;
  return (
    <div style={textWrap()}>
      {load.truncated && <TruncatedBanner cap={cap} />}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg-surface)" }}>
        <pre
          style={{
            margin: "0 auto",
            padding: prose ? "24px clamp(20px, 6vw, 48px)" : "20px 24px",
            maxWidth: prose ? "72ch" : "none",
            fontFamily: prose ? "var(--font-sans)" : "var(--font-mono)",
            fontVariantNumeric: prose ? "normal" : "tabular-nums",
            fontSize: prose ? "var(--text-md)" : "var(--mono-sm)",
            lineHeight: prose ? "var(--leading-normal)" : 1.6,
            color: "var(--fg-default)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {load.body}
        </pre>
      </div>
    </div>
  );
}

function MarkdownStage({ file }: { file: FileDto }) {
  const load = useCappedText(file, MD_CAP_BYTES);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (load.state !== "ready" || !load.body) return;
    (async () => {
      // marked.parse returns a string in v18; await to support a future
      // async pipeline without breaking the build.
      const raw = await Promise.resolve(marked.parse(load.body!, { gfm: true, breaks: false }));
      // Sanitize. Default DOMPurify config strips iframe/object/embed/form
      // and dangerous attrs by default; we add ADD_ATTR for target/rel so
      // anchor tags can open in a new tab without getting scrubbed.
      const clean = DOMPurify.sanitize(raw, {
        ADD_ATTR: ["target", "rel"],
        FORBID_TAGS: ["iframe", "object", "embed", "form", "style"],
      });
      setHtml(clean);
    })();
  }, [load.state, load.body]);

  if (load.state === "loading") return <PreviewSkeleton lines />;
  if (load.state === "error") return <ErrorState file={file} />;
  if (html === null) return <PreviewSkeleton lines />;

  return (
    <div style={textWrap()}>
      {load.truncated && <TruncatedBanner cap={MD_CAP_BYTES} />}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg-surface)" }}>
        <div
          className="cd-md"
          style={{
            margin: "0 auto",
            padding: "28px clamp(20px, 6vw, 48px) 48px",
            maxWidth: "72ch",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-md)",
            lineHeight: "var(--leading-normal)",
            color: "var(--fg-default)",
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <style>{`
        .cd-md h1, .cd-md h2, .cd-md h3, .cd-md h4 {
          font-family: var(--font-display);
          font-weight: var(--weight-semibold);
          letter-spacing: var(--tracking-tight);
          color: var(--fg-default);
          margin: 1.4em 0 .5em;
          line-height: var(--leading-tight);
        }
        .cd-md h1 { font-size: var(--text-xl); }
        .cd-md h2 { font-size: var(--text-lg); }
        .cd-md h3 { font-size: var(--text-md); }
        .cd-md p  { margin: .7em 0; }
        .cd-md a  { color: var(--amber-700); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
        .cd-md code {
          font-family: var(--font-mono);
          background: var(--bg-sunken);
          border: 1px solid var(--border-hair);
          border-radius: var(--radius-xs);
          padding: 1px 5px;
          font-size: .9em;
        }
        .cd-md pre {
          background: var(--bg-sunken);
          border: 1px solid var(--border-hair);
          border-radius: var(--radius-md);
          padding: 12px 14px;
          overflow: auto;
          font-size: var(--mono-sm);
          line-height: 1.6;
        }
        .cd-md pre code { background: transparent; border: 0; padding: 0; }
        .cd-md blockquote {
          margin: 1em 0;
          padding: 4px 14px;
          border-left: 2px solid var(--accent);
          color: var(--fg-muted);
          background: var(--bg-sunken);
          border-radius: 0 var(--radius-md) var(--radius-md) 0;
        }
        .cd-md ul, .cd-md ol { padding-left: 22px; }
        .cd-md li { margin: .25em 0; }
        .cd-md hr { border: 0; border-top: 1px solid var(--border-hair); margin: 1.6em 0; }
        .cd-md img { max-width: 100%; height: auto; border-radius: var(--radius-md); }
        .cd-md table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: var(--text-base); }
        .cd-md th, .cd-md td { border: 1px solid var(--border-hair); padding: 6px 10px; text-align: left; }
        .cd-md th { background: var(--bg-sunken); font-weight: var(--weight-medium); }
      `}</style>
    </div>
  );
}

// ── Glyph fallback (opaque / folder / generic) ─────────────────────────

function GlyphFallback({ file, kind }: { file: FileDto; kind: FileKind }) {
  const isFolder = kind === "fold";
  return (
    <div style={{ ...stageWrap(), flexDirection: "column", gap: 18, padding: 24 }}>
      <div
        style={{
          width: "min(300px, 68%)",
          aspectRatio: isFolder ? "1 / 1" : "1 / 1.3",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          border: "var(--border-w) solid var(--border)",
          boxShadow: "var(--shadow)",
        }}
      >
        <FileThumb name={file.name} kind={kind} size="big" thumbnail={file.thumbnail} />
      </div>
      {!isFolder && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>
            No inline preview for this format.
          </span>
          <DownloadButton file={file} />
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────

function stageWrap(): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-canvas)",
    boxSizing: "border-box",
  };
}

function textWrap(): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  };
}

/** Content-shaped skeleton (spec §7.13 — content = skeletons, not
 *  spinners). Renders a paper sheet with shimmer bars; `lines` variant
 *  mimics a text/markdown document. Static under reduced motion via the
 *  `.skeleton` utility. */
function PreviewSkeleton({ lines }: { lines?: boolean }) {
  return (
    <div style={{ ...stageWrap(), padding: 24 }} role="status" aria-label="Loading preview">
      <div
        style={{
          width: "min(640px, 100%)",
          height: "min(100%, 520px)",
          background: "var(--bg-surface)",
          border: "var(--border-w) solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: lines ? "32px clamp(20px, 6vw, 44px)" : 20,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: lines ? 12 : 14,
          overflow: "hidden",
        }}
      >
        {lines ? (
          <>
            <div className="skeleton" style={{ height: 20, width: "48%", borderRadius: "var(--radius-xs)", marginBottom: 8 }} />
            {["96%", "88%", "92%", "70%", "94%", "82%", "90%", "58%", "86%"].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 11, width: w, borderRadius: "var(--radius-2xs)" }} />
            ))}
          </>
        ) : (
          <div className="skeleton" style={{ flex: 1, width: "100%", borderRadius: "var(--radius-md)" }} />
        )}
      </div>
    </div>
  );
}

/** Wraps the doc editor iframe with an app-side error state. When the
 *  SDK fires `casual.error` for a parse / load / boot failure we render
 *  ErrorState instead of the iframe so users never see the raw SDK error
 *  UI ("Failed to Load Document", red stack-trace text). */
function ErrorAwareDoc({ file }: { file: FileDto }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <ErrorState file={file} />;
  return <CasualDocEditor file={file} mode="preview" onError={() => setErrored(true)} />;
}

function ErrorAwareSheet({ file }: { file: FileDto }) {
  const [errored, setErrored] = useState(false);
  if (errored) return <ErrorState file={file} />;
  return <CasualSheetWorkspace file={file} mode="preview" onError={() => setErrored(true)} />;
}

/** On-brand inline error — document glyph, a plain explanation, and a
 *  Download escape hatch. Icon is paired with text (never colour alone). */
function ErrorState({ file }: { file: FileDto }) {
  const k = inferKind(file.name, file.content_type);
  return (
    <div
      role="alert"
      style={{ ...stageWrap(), flexDirection: "column", gap: 16, padding: 24, textAlign: "center" }}
    >
      <div
        style={{
          width: "min(220px, 52%)",
          aspectRatio: "1 / 1.3",
          borderRadius: "var(--radius)",
          overflow: "hidden",
          border: "var(--border-w) solid var(--border)",
          boxShadow: "var(--shadow)",
          opacity: 0.9,
        }}
      >
        <FileThumb name={file.name} kind={k} size="big" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-bold)",
            color: "var(--danger)",
          }}
        >
          <AlertTriangle size={14} strokeWidth={2.2} aria-hidden />
          Couldn&apos;t load the preview.
        </span>
        <DownloadButton file={file} />
      </div>
    </div>
  );
}

function DownloadButton({ file }: { file: FileDto }) {
  return (
    <a
      href={downloadUrl(file.id)}
      download
      className="press-sink"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 12px",
        border: "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "var(--shadow-sm)",
        background: "var(--bg-raised)",
        color: "var(--fg-default)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: "var(--weight-bold)",
        textDecoration: "none",
      }}
    >
      <Download size={14} strokeWidth={2.2} aria-hidden />
      Download
    </a>
  );
}

function TruncatedBanner({ cap }: { cap: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
        background: "var(--accent-wash)",
        borderBottom: "var(--border-w) solid var(--border)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        color: "var(--violet-600)",
      }}
    >
      <ScrollText size={13} strokeWidth={2} aria-hidden />
      Showing the first {formatBytes(cap)}. Download the full file for the rest.
    </div>
  );
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
