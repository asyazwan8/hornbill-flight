import { defineConfig, type Plugin } from "vite";

/**
 * Serve the game at /demo as well. The page reads its mode from the address,
 * so the demo needs no markup of its own -- only the built index.html at a
 * second path, which any static host will then serve without rewrite rules.
 * The dev server needs none of this: its SPA fallback already answers /demo
 * with index.html. Every asset URL in the page is absolute, so the copy works
 * unchanged one directory down.
 */
function demoPage(): Plugin {
  return {
    name: "demo-page",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const page = bundle["index.html"];
        if (page?.type !== "asset") return;
        this.emitFile({ type: "asset", fileName: "demo/index.html", source: page.source });
      },
    },
  };
}

export default defineConfig({
  plugins: [demoPage()],
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
