import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** 产物进 `dist/web`，由 `createMonitor` 当静态文件提供；`dev:web` 把 `/api` 代理到一个在跑的监控。 */
export default defineConfig({
	root: here("."),
	base: "./",
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": here("./src") } },
	build: { outDir: here("../dist/web"), emptyOutDir: true },
	server: { proxy: { "/api": process.env.MONITOR_URL ?? "http://127.0.0.1:8790" } },
});
