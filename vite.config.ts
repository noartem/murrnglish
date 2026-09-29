import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// books/ sits next to src/ but is never part of the app: its served files
// reach public/books/ through scripts/sync_books.mjs. Kept out of the watcher
// (hundreds of MB of pipeline work files) and of the dependency scan (the red
// book's EPUB is full of .html files Vite would take for entry points).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/books/**"] },
  },
  optimizeDeps: { entries: ["index.html"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
