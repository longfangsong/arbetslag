import type { EffectKindDefinition } from "@arbetslag/kernel";
import { z } from "zod";
import type { Performer } from "../executor.ts";

/**
 * `timer.wait`：等一段时间。声明和**实现**都在这里。
 * 也是写自定义效果种类时的最小样板：一份 kind 声明 + 一个 **Performer**。
 */
export const timerKind: EffectKindDefinition = {
	kind: "timer.wait",
	input: z.object({ ms: z.number().int().nonnegative() }),
	result: z.null(),
};

export const timerPerformer: Performer = async (input) => {
	const { ms } = input as { ms: number };
	if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
	return null;
};
