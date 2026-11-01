import { z } from "zod";
import type { EffectKindDefinition } from "../../effect/index.ts";
import { jsonSchema } from "../../message.ts";
import { workflowTemplateSchema } from "./template.ts";

/**
 * 交给新工作流的那条事件（ADR-0015）：总机收到它时它已经被路由处理并确认过了，
 * 没有第二次路由，所以由 `workflow.spawn` 原样转交。
 */
export const spawnForwardSchema = z.object({
	trigger: z.string().min(1),
	output: z.string().min(1),
	body: jsonSchema,
	eventId: z.string().min(1).optional(),
});

export const workflowSpawnInputSchema = z.object({
	/** 新工作流的 id；已存在不是失败：跳过实例化，只转交。 */
	id: z.string().min(1),
	/** 一份完整的模板数据（ADR-0002：模板是数据，只在实例化时被读一次）。 */
	template: workflowTemplateSchema,
	forward: spawnForwardSchema.optional(),
});

export type WorkflowSpawnInput = z.infer<typeof workflowSpawnInputSchema>;

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
