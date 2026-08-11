import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    // MediaPipe's wasm loader is happiest when these are served with the
    // default MIME types; nothing custom is needed, but exposing the host
    // lets you test on a phone over the LAN.
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
