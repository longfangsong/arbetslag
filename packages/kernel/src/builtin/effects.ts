import { z } from "zod";
import type { EffectKindDefinition } from "../effect/index.ts";
import { jsonSchema } from "../message.ts";
import { graphOpSchema } from "../workflow/graph/ops.ts";
import { workflowSpawnInputSchema } from "../workflow/template/spawn.ts";

/**
 * 框架提供的效果种类 `graph.mutate`（ADR-0006）：`input` 是一批操作，
 * `result` 是成功，或失败加违规列表。注册表自带它，宿主不用也不能再注册同名种类。
 */
export const graphMutateEffect: EffectKindDefinition = {
	kind: "graph.mutate",
	input: z.object({ ops: z.array(graphOpSchema) }),
	result: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), violations: z.array(jsonSchema) }),
	]),
};

/**
 * 框架提供的效果种类 `workflow.spawn`（ADR-0015）：声明随内核发布，与 `graph.mutate` 一样；
 * 执行归宿主，因为它跨工作流。注册表自带它，宿主不用也不能再注册同名种类。
 */
export const workflowSpawnEffect: EffectKindDefinition = {
	kind: "workflow.spawn",
	input: workflowSpawnInputSchema as unknown as EffectKindDefinition["input"],
	result: z.union([
		z.object({ ok: z.literal(true), created: z.boolean() }),
		z.object({ ok: z.literal(false), error: z.string() }),
	]),
};
