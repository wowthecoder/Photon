import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:* http://127.0.0.1:*";

export default defineConfig({
  plugins: [
    react(),
    { name: "csp", apply: "build", transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }] },
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  base: "./",
});
