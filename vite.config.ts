import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: photon-image:; connect-src 'self' http://127.0.0.1:* https://huggingface.co";

export default defineConfig({
  plugins: [
    react(),
    { name: "csp", apply: "build", transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }] },
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  base: "./",
});
