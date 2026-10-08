# AGENTS.md

arbetslag 是一个 monorepo（pnpm workspace），只包含一个包 `packages/arbetslag`：
一个**核心可在 Cloudflare Workers 运行、同时提供可选 Node 支持**的库。

## 命令

- `pnpm build`：tsdown 构建（多入口，ESM-only）
- `pnpm type-check`：`tsc --noEmit`（TypeScript 7）
- `pnpm lint` / `pnpm lint:check`：biome
- `pnpm format` / `pnpm format:check`：biome format

## 入口 / exports 约定（重要）

包采用「多入口 + subpath 导出」：

- 根入口 `.` → `src/index.ts`：**平台无关的核心**（domain：`Agent`、`Template`、`Orchestrator`、`JsonStorage`、`history` 等）。
- Node 专属入口 `./node` → `src/node.ts`：所有依赖 Node API 的实现（如 `NodeFileSystemStorage`）。

`package.json` 的 `exports` 映射（**每个入口都要有 `types` + `import`，且 `types` 在前**）：

```json
"exports": {
  ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs" },
  "./node": { "types": "./dist/node.d.mts", "import": "./dist/node.mjs" }
}
```

### 规则

1. **Node-only 代码只能放在 `src/node.ts`（或其子模块）里，并且只能通过 `./node` subpath 导出。** 绝不允许在 `src/index.ts` 里 re-export 任何 Node 模块（如 `node:fs`），否则 `node:fs` 会被打进 Workers 的 bundle。
2. 新增一个 Node 专属实现时：
   - 把它放在 `src/` 下（例如 `src/implementation/...`）；
   - 在 `src/node.ts` 里 re-export；
   - 如果它需要**独立 subpath**（不只是挂在 `./node` 下），则在 `tsdown.config.ts` 加 entry，并在 `package.json` 的 `exports` 加对应子路径（`types` + `import`）。
3. 核心（`src/index.ts`）保持平台无关：**不 import 任何 `node:` 内置模块、不 import 任何 Node-only 实现**。
4. `package.json` 保留 `"sideEffects": false`，让 bundler 能 tree-shake 掉不可达的 subpath。
5. 每个 subpath 都要有对应的 `.d.mts` 类型文件（tsdown 的 `dts: true` 会生成）。
6. `package.json` 的 `exports` 是 ESM-only（只有 `import`）。不要为了旧的 CJS 消费者加 `"require"` 分支——要么提供 CJS 构建，要么保持 ESM-only。

## Node-only 运行时护栏

任何 Node-only 的类（如 `NodeFileSystemStorage`）在构造器里检测 Workers 环境并抛错：

```ts
if (typeof (globalThis as Record<string, unknown>).WorkerGlobalScope !== "undefined") {
  throw new Error("Node-only API cannot be used in Cloudflare Workers");
}
```

原因：Workers 里即使能 import `node:fs`，它也是按请求隔离的内存 VFS，不持久——静默使用会导致数据每次请求都丢失。

## 注意

- `@types/node` 已作为 devDependency（走 catalog），`tsconfig.json` 里 `"types": ["node"]`。
- wrangler 的 esbuild 默认 conditions 是 `workerd` / `worker` / `browser`（加 ESM 的 `import`），**不含 `node`**。所以不要用 `"node"` condition 来隔离模块，要用**显式 subpath**（如 `./node`）。
- 若以后核心本身在两个平台需要不同实现（如 fetch 适配器），再升级到 conditional exports（用 `workerd` / `browser` condition 做 dual-build），subpath 结构可平滑保留。
