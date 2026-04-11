import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/ollama": "src/providers/ollama.ts",
    "providers/gemini": "src/providers/gemini.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  target: "es2020",
  splitting: false,
  minify: false,
  external: [],
});
