import { z } from "zod";
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

