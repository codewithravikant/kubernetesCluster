import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_HOST = process.env.HOST || "127.10.10.10";
const API_PORT = process.env.API_PORT || "3031";
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;
const WS_ORIGIN = `ws://${API_HOST}:${API_PORT}`;

export default defineConfig({
  plugins: [react()],
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
        },
      },
    },
  },
  server: {
    host: API_HOST,
    port: 3030,
    strictPort: true,
    proxy: {
      "/api": API_ORIGIN,
      "/open": API_ORIGIN,
      "/ws": {
        target: WS_ORIGIN,
        ws: true,
      },
    },
  },
});
