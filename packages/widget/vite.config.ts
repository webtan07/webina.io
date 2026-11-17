/**
 * One file out.
 *
 * A business pastes a `<script>` tag on its site, so the widget must be a single
 * self-contained JavaScript file — Preact, the styles and the branding all
 * inside it, no second request, no stylesheet to forget. The styles live in the
 * bundle as a string and are injected into the shadow root, which is also why
 * there is no `cssCodeSplit` output to lose.
 *
 * The output lands in `apps/web/public/`, so the dashboard app serves the same
 * bundle at `/webina-widget.js` until `cdn.webina.io` takes over the job.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "WebinaWidget",
      formats: ["iife"],
      fileName: () => "webina-widget.js",
    },
    outDir: "../../apps/web/public",
    emptyOutDir: false,
    target: "es2020",
    minify: "esbuild",
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/*.test.ts"],
    testTimeout: 20_000,
  },
});
