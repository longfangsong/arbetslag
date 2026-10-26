import { z } from "zod";
import type { EffectKindDefinition } from "@arbetslag/kernel";
import type { Performer } from "../executor.ts";

/**
 * 最小的一种宿主内效果：等一段时间。回执是 `null`。
 *
 * 它的用处是让图里出现「真会耗时」的步骤而不必依赖网络；也是写自定义效果种类
 * 时的最小样板：一个 kind 定义（名字 + input/result schema）+ 一个 **Performer**。
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
