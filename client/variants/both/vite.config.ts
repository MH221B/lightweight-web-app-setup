import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react({ compiler: true }), tailwindcss()],
  resolve: {
    alias: {
      "@client": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.PORT ?? 3000}`,
        changeOrigin: true,
      },
    },
  },
});
