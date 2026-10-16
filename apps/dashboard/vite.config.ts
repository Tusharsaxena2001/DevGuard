import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dashboard talks to the API through a same-origin proxy: the session cookie is httpOnly and SameSite=Lax, and no
// CORS is involved. `DEVGUARD_API_URL` points the proxy at a non-default API.
const api = process.env["DEVGUARD_API_URL"] ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/v1": api, "/health": api } },
  preview: { port: 5173, proxy: { "/v1": api, "/health": api } },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"], css: false, testTimeout: 15_000 },
});
