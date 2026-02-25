import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared/types": resolve(__dirname, "src/types.ts"),
    },
  },
  server: {
    port: 3998,
    proxy: {
      "/api": "http://localhost:3999",
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
