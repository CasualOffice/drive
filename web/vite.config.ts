import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// In dev, proxy API + WOPI + health endpoints through to the backend bound at
// DRIVE_DEV_BACKEND (default http://127.0.0.1:18090). The SPA itself serves
// on its own port — Vite's dev server.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.DRIVE_DEV_BACKEND ?? "http://127.0.0.1:18090";
  // Asset root override. Real-Drive builds embed into the binary at "/";
  // the marketing site mounts the demo at "/demo-app/" and needs hashed
  // asset URLs scoped under that prefix. CI sets VITE_BASE accordingly.
  const base = env.VITE_BASE ?? "/";

  return {
    base,
    plugins: [react(), tailwindcss()],
    worker: {
      // The editor SDK ships `format-converter.worker.mjs` (from
      // @schnsrw/docx-js-editor@1.0.1 onward) and references it via
      // `new Worker(new URL(...), import.meta.url)`. Vite's worker
      // bundler defaults to 'iife', which is incompatible with the
      // code-splitting build; the editor's worker code-splits its
      // ESM-format dependencies, so the host needs to pick ESM too.
      format: "es",
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: backend, changeOrigin: true },
        "/healthz": { target: backend, changeOrigin: true },
        "/wopi": { target: backend, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      assetsDir: "assets",
      // The editor SDK + Univer + ProseMirror combined push the index
      // chunk past 2 MB. Split them into dedicated vendor chunks so the
      // shell stays small and lazy-loaded surfaces (the Preview modal's
      // doc / sheet stages) pull the heavy bundles only when actually
      // opened.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            // Group React + React-DOM + scheduler in one vendor chunk so
            // no other chunk needs to reach across the boundary for a
            // partial React export (which previously created a circular
            // dep with vendor-docx-editor and crashed React's module
            // init with "Cannot set properties of undefined (Activity)").
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return "vendor-react";
            }
            if (id.includes("@univerjs/")) return "vendor-univer";
            if (id.includes("@schnsrw/casual-sheets")) return "vendor-univer";
            if (id.includes("@schnsrw/docx-js-editor")) return "vendor-docx-editor";
            if (id.includes("prosemirror-")) return "vendor-docx-editor";
            if (id.includes("yjs") || id.includes("y-prosemirror") || id.includes("y-websocket")) {
              return "vendor-collab";
            }
            return undefined;
          },
        },
      },
    },
  };
});
