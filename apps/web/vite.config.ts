import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const apiOrigin = process.env.API_ORIGIN ?? (mode === "e2e" ? "http://localhost:4100" : "http://localhost:4000");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiOrigin,
          changeOrigin: true
        },
        "/docs": {
          target: apiOrigin,
          changeOrigin: true
        }
      }
    }
  };
});
