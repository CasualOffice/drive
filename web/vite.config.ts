import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// In dev, proxy API + WOPI + health endpoints through to the backend bound at
// DRIVE_DEV_BACKEND (default http://127.0.0.1:18090). The SPA itself serves
// on its own port — Vite's dev server.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.DRIVE_DEV_BACKEND ?? "http://127.0.0.1:18090";

  return {
    plugins: [react(), tailwindcss()],
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
      // Tighter chunk policy → smaller initial load. The shell stays
      // small; vendor chunks split off automatically.
      rollupOptions: {
        output: { manualChunks: undefined },
      },
    },
  };
});
