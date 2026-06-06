import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, UploadCloud } from "lucide-react";

import * as api from "../api/client.ts";
import { ApiError } from "../api/client.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { FileRowComponent, FolderRow } from "../components/FileRow.tsx";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: api.ListResp }
  | { kind: "error"; message: string };

export function Files() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const data = await api.listRoot();
      setState({ kind: "ready", data });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 401
            ? "Signed out for security."
            : `Couldn't load files (${err.status}).`
          : "Couldn't reach the server.";
      setState({ kind: "error", message: msg });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadAll = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading(list.map((f) => f.name));
      const results = await Promise.allSettled(
        list.map((f) => api.uploadFile(f, null)),
      );
      setUploading([]);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      if (ok < results.length) {
        console.warn(`Uploaded ${ok}/${results.length} files`);
      }
      void refresh();
    },
    [refresh],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void uploadAll(e.dataTransfer.files);
    }
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      void uploadAll(e.target.files);
    }
    e.target.value = "";
  }

  function onDownload(id: string) {
    window.location.assign(api.downloadUrl(id));
  }

  function onOpenFolder(_id: string) {
    // Folder navigation lands in the next slice (router + breadcrumbs).
  }

  // Keyboard: `U` opens the file picker from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() === "u" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        fileInputRef.current?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = useMemo(
    () =>
      state.kind === "ready" ? state.data.folders.length + state.data.files.length : 0,
    [state],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-default)",
        overflow: "auto",
      }}
    >
      {/* Breadcrumbs + actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "40px",
          padding: "0 var(--space-6)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <div
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
            color: "var(--fg-default)",
          }}
        >
          Home
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={onFilePicked}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="cd-primary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-2) var(--space-3)",
              background: "var(--accent)",
              color: "var(--fg-onAccent)",
              fontSize: "var(--text-sm)",
              fontWeight: "var(--weight-medium)",
              fontFamily: "var(--font-sans)",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <Upload size={14} strokeWidth={2} />
            <span>Upload</span>
            <span
              className="tabular-nums"
              style={{
                marginLeft: "var(--space-1)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                opacity: 0.85,
                background: "rgba(255,255,255,0.16)",
                padding: "2px 6px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              U
            </span>
          </button>
        </div>
      </div>

      {/* Sort header — visual only in v0 */}
      {state.kind === "ready" && total > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 160px 96px 120px",
            gap: "var(--space-3)",
            alignItems: "center",
            height: "36px",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--border-default)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-medium)",
            color: "var(--fg-muted)",
            textTransform: "none",
          }}
        >
          <span>Name</span>
          <span>Modified</span>
          <span style={{ textAlign: "right" }}>Size</span>
          <span>Type</span>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: "var(--space-2) var(--space-2)" }}>
        {state.kind === "loading" && <ListSkeleton />}
        {state.kind === "ready" && total === 0 && uploading.length === 0 && (
          <div style={{ paddingTop: "var(--space-12)" }}>
            <EmptyState
              title="Your Drive is empty."
              subtitle="Drop files anywhere, or use Upload."
              cta={
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    background: "var(--accent)",
                    color: "var(--fg-onAccent)",
                    padding: "var(--space-2) var(--space-4)",
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-medium)",
                    fontFamily: "var(--font-sans)",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <Upload size={16} strokeWidth={2} />
                  <span>Upload</span>
                  <span
                    className="tabular-nums"
                    style={{
                      marginLeft: "var(--space-1)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      opacity: 0.85,
                      background: "rgba(255,255,255,0.16)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-xs)",
                    }}
                  >
                    U
                  </span>
                </button>
              }
            />
          </div>
        )}
        {state.kind === "ready" && total > 0 && (
          <div>
            {state.data.folders.map((f) => (
              <FolderRow key={f.id} folder={f} onOpen={onOpenFolder} />
            ))}
            {state.data.files.map((f) => (
              <FileRowComponent key={f.id} file={f} onDownload={onDownload} />
            ))}
            {uploading.map((name) => (
              <GhostRow key={name} name={name} />
            ))}
          </div>
        )}
        {state.kind === "error" && (
          <div style={{ paddingTop: "var(--space-12)" }}>
            <EmptyState title="Couldn't load files." subtitle={state.message} />
          </div>
        )}
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--bg-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            transition: "background var(--dur-fast) var(--ease-out)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-6) var(--space-8)",
              border: "2px dashed var(--accent)",
              borderRadius: "var(--radius-xl)",
              background: "var(--bg-default)",
              color: "var(--fg-default)",
            }}
          >
            <UploadCloud size={32} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
            <span
              style={{
                fontSize: "var(--text-md)",
                fontWeight: "var(--weight-medium)",
              }}
            >
              Drop to upload to Home
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 160px 96px 120px",
            gap: "var(--space-3)",
            alignItems: "center",
            height: "32px",
            padding: "0 var(--space-4)",
          }}
        >
          <Shimmer width="40%" />
          <Shimmer width="80%" />
          <Shimmer width="60%" />
          <Shimmer width="50%" />
        </div>
      ))}
    </div>
  );
}

function Shimmer({ width }: { width: string }) {
  return (
    <div
      style={{
        height: "12px",
        width,
        background: "var(--bg-subtle)",
        borderRadius: "var(--radius-xs)",
      }}
    />
  );
}

function GhostRow({ name }: { name: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 160px 96px 120px",
        gap: "var(--space-3)",
        alignItems: "center",
        height: "32px",
        padding: "0 var(--space-4)",
        opacity: 0.6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <UploadCloud size={14} strokeWidth={2} style={{ color: "var(--accent)" }} />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "var(--text-sm)",
            fontWeight: "var(--weight-medium)",
          }}
        >
          {name}
        </span>
      </div>
      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }}>
        Uploading…
      </span>
      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)", textAlign: "right" }}>
        —
      </span>
      <span style={{ color: "var(--fg-muted)", fontSize: "var(--text-sm)" }} />
    </div>
  );
}
