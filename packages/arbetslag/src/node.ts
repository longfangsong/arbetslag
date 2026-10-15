/**
 * Node.js-only entry point. Anything exported here may import `node:*` modules
 * and is not safe on Cloudflare Workers and other non-Node runtimes — keep
 * runtime-agnostic exports in `index.ts` instead.
 */
export { NodeFsStore } from "./implementation/store/nodeFsStore";
