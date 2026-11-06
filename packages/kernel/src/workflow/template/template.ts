import { z } from "zod";
import { jsonSchema } from "../../message.ts";
import { edgeSchema } from "../shape/edge.ts";
import { triggerSchema } from "../shape/trigger.ts";

/** 模板里的一个节点：定义名、config，以及可省略的初始 state。 */
export const templateNodeSchema = z.object({
	definition: z.string().min(1),
	config: jsonSchema,
	/** 省略时由节点定义的 `state` schema 解析 `undefined` 得到（带默认值的 schema）。 */
	state: jsonSchema.optional(),
});

/**
 * 一份声明式的图种子（CONTEXT.md）：初始形状与节点配置。
 * 只在实例化时被读一次，之后工作流与它无关（ADR-0002）。
 */
export const workflowTemplateSchema = z.object({
	/**
	 * 参数与它们的默认值（ADR-0018）：模板里的字符串值用 `{{name}}` 引用。
	 * 实例化之前由 `fillTemplate` 填掉，快照里没有它。
	 */
	params: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), jsonSchema).optional(),
	nodes: z.record(z.string().min(1), templateNodeSchema),
	edges: z.array(edgeSchema).default([]),
	triggers: z.array(triggerSchema).default([]),
});

/** 手写模板时 `edges` / `triggers` 可省略。 */
export type WorkflowTemplate = z.input<typeof workflowTemplateSchema>;
