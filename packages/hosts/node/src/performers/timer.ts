import { timerWaitKind } from "@arbetslag/agents";
import type { Performer } from "../executor.ts";

/**
 * `timer.wait` 的声明在 `@arbetslag/agents`（发它的人声明它），这里只有**实现**。
 * 也是写自定义效果种类时的最小样板：一份 kind 声明 + 一个 **Performer**。
 */
export { timerWaitKind as timerKind };

export const timerPerformer: Performer = async (input) => {
	const { ms } = input as { ms: number };
	if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
	return null;
};
