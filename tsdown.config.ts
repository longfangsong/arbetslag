import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Do not use shims: true — it injects Node.js polyfills (fs, path, etc.)
  // that are not available in edge runtimes (Cloudflare Workers, etc.).
  // Node.js builtins (fs, path) used in agentLoader.ts and nodefs.ts are
  // externalized by default, keeping the bundle edge-compatible.
  target: "es2020",
  minify: false,
});
