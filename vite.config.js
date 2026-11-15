import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Stessa variabile di start.sh: API_PORT=8001 npm run dev
const apiPort = process.env.API_PORT || "8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
});
