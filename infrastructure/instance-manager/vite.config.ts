import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
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
