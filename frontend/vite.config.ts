import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    target: "es2024",
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      name: "RoomMindPanel",
      formats: ["iife"],
      fileName: () => "roommind-panel.js",
    },
    outDir: "../custom_components/roommind/frontend",
    emptyOutDir: true,
    rollupOptions: {
      // No external dependencies – everything is bundled
    },
  },
});
