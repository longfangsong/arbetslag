import { z } from "zod";
import { jsonSchema } from "../../message.ts";

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
	/**
	 * 模板的名字（ADR-0018）：宿主在执行这次 spawn 时从它的模板目录里取，填参数、实例化。
	 * 名字不存在、参数不合、模板不合规都是失败回执，不停住。
	 */
	template: z.string().min(1),
	/** 模板参数；没给的取模板声明的默认值。 */
	params: z.record(z.string(), jsonSchema).optional(),
	forward: spawnForwardSchema.optional(),
});

export type WorkflowSpawnInput = z.infer<typeof workflowSpawnInputSchema>;

