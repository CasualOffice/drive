/**
 * CodeTextEditor — Doc-Hub's light embedded editor for the plain-text
 * document kinds in the ingest allowlist: `.md`, `.txt`, `.csv`,
 * `.json`, `.yaml`. It is the third editor host alongside the Casual
 * Docs (`.docx`) and Casual Sheet (`.xlsx`) SDK mounts, wired into the
 * same fullscreen surface (`/document/{id}/edit`).
 *
 * Load  — fetches the head version's decrypted bytes through the shared
 *         `DriveFileSource` (GET /api/files/{id}/content) and decodes
 *         them as UTF-8 into an editable buffer.
 * Save  — encodes the buffer and hands it back through the same source
 *         (PUT /api/files/{id}/content), which commits a new encrypted,
 *         hash-chained version server-side. The response carries the
 *         new head; we surface it as "Saved as v{n}" and hand the fresh
 *         FileDto up so the shell's version chip advances.
 *
 * There is no CodeMirror dependency in `web/`, so per the Phase-2 build
 * spec (§2, D3) this is a tokenised `<textarea>` — a monospaced buffer
 * with a scroll-synced line-number gutter and Tab-to-indent. It stays
 * behind the same save→version contract; a richer editor can drop in
 * later without changing the host.
 *
 * The shell (FileFullscreen) owns the dense Doc-Hub chrome — title,
 * version chip, history link, close. This component owns only a slim
 * editing toolbar (Save + dirty hint) and the buffer, mirroring how the
 * SDK editors own their in-iframe toolbar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { type FileDto } from "../../api/client.ts";
import { DriveFileSource } from "../../file-source/DriveFileSource.ts";
import type { OnSaveStatus } from "./save-status.ts";

export interface CodeTextEditorProps {
  file: FileDto;
  /** Fires on every save transition — drives the shell's save pill. */
  onSaveStatus?: OnSaveStatus;
  /** Fires with the freshly-committed FileDto after a successful save so
   *  the host can advance its version chip / details. */
  onSaved?: (file: FileDto) => void;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; text: string }
  | { kind: "error"; message: string };

export function CodeTextEditor({ file, onSaveStatus, onSaved }: CodeTextEditorProps) {
  const source = useMemo(() => new DriveFileSource(file), [file.id]);

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Latch callbacks so the save closure never goes stale without
  // rebinding the keydown listener on every keystroke.
  const onSaveStatusRef = useRef(onSaveStatus);
  onSaveStatusRef.current = onSaveStatus;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // Cold load — decrypted head bytes → UTF-8 buffer.
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    (async () => {
      try {
        const { bytes } = await source.open(file.id);
        if (cancelled) return;
        const text = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
        setValue(text);
        setDirty(false);
        setLoad({ kind: "ready", text });
      } catch (err) {
        if (cancelled) return;
        setLoad({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, file.id]);

  const save = useCallback(async () => {
    if (load.kind !== "ready" || saving) return;
    const current = taRef.current?.value ?? value;
    setSaving(true);
    onSaveStatusRef.current?.({ kind: "saving" });
    try {
      const bytes = new TextEncoder().encode(current);
      await source.save(file.id, bytes.buffer as ArrayBuffer);
      const updated = source.currentFile();
      setDirty(false);
      setLoad({ kind: "ready", text: current });
      onSaveStatusRef.current?.({ kind: "saved", at: Date.now(), version: updated.version });
      onSavedRef.current?.(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onSaveStatusRef.current?.({ kind: "failed", message });
      toast.error(`Couldn't save — ${message}`);
    } finally {
      setSaving(false);
    }
  }, [load.kind, saving, value, source, file.id]);

  // Cmd/Ctrl+S saves from anywhere on the surface.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Warn before a hard unload with unsaved edits (navigation inside the
  // SPA is the user's call; this only guards tab-close / refresh).
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const syncScroll = () => {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  };

  const onTextKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      setValue(next);
      setDirty(true);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const lineCount = useMemo(() => Math.max(value.split("\n").length, 1), [value]);
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  if (load.kind === "loading") {
    return (
      <div style={centerStyle} role="status" aria-label="Opening document">
        <span style={{ fontSize: "var(--text-sm)", color: "var(--fg-muted)" }}>Loading editor…</span>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div style={centerStyle} role="alert">
        <span
          style={{
            fontSize: "var(--text-md)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--status-danger-700)",
          }}
        >
          Couldn&apos;t open this document
        </span>
        <span style={{ fontSize: "var(--text-base)", color: "var(--fg-muted)", maxWidth: 420 }}>
          {load.message}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="code-text-editor"
      style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-canvas)" }}
    >
      {/* Editor-owned toolbar row — the shell owns the outer chrome. */}
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 40,
          padding: "0 16px",
          borderBottom: "1px solid var(--border-hair)",
          background: "var(--bg-surface)",
        }}
      >
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          data-testid="code-text-editor-save"
          title="Save (⌘S)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 12px",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            background: dirty ? "var(--accent, var(--bg-raised))" : "var(--bg-raised)",
            color: dirty ? "var(--accent-fg, var(--fg-default))" : "var(--fg-muted)",
            cursor: saving || !dirty ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
          }}
        >
          <Save size={14} strokeWidth={1.5} />
          Save
        </button>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--fg-muted)" }}>
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>

      {/* Buffer — mono textarea + scroll-synced line-number gutter. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div
          ref={gutterRef}
          aria-hidden
          style={{
            flex: "0 0 auto",
            overflow: "hidden",
            padding: "16px 8px 16px 16px",
            textAlign: "right",
            whiteSpace: "pre",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.6,
            color: "var(--fg-faint, var(--fg-muted))",
            background: "var(--bg-sunken)",
            borderRight: "1px solid var(--border-hair)",
            userSelect: "none",
          }}
        >
          {gutter}
        </div>
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          data-testid="code-text-editor-textarea"
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
          onKeyDown={onTextKeyDown}
          onScroll={syncScroll}
          style={{
            flex: 1,
            minWidth: 0,
            resize: "none",
            border: "none",
            outline: "none",
            padding: "16px 20px",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.6,
            color: "var(--fg-default)",
            background: "var(--bg-canvas)",
            whiteSpace: "pre",
            overflow: "auto",
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}

const centerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  textAlign: "center",
  background: "var(--bg-canvas)",
};
