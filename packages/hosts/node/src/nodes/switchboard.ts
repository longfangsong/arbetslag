import type { JsonValue } from "type-fest";
import { defineNode, isReservedType } from "@arbetslag/kernel";
import { z } from "zod";

/**
 * 总机（ADR-0015、0018）：订阅一个监听器上没人认领的事件，为它起一份新工作流并把这条事件转交过去。
 * 全是 config，不写代码：
 * - `template`：模板目录里的模板名；
 * - `params`：模板参数 ← 载荷里的哪个字段（只看顶层字段，值须是字符串、数字或布尔）；
 * - `trigger`：新工作流里接这条事件的那个触发器；
 * - `eventId`：载荷里哪个字段当来源的事件 id（路由按它去重），省略就不给。
 *
 * 新工作流的 id 是模板名与各参数值依次用 `:` 连起来（`chat:bot-a:42`）：同一组参数总是同一份工作流。
 * id 不用样式字符串：总机自己也是从模板实例化的，样式里的占位符会被当成总机模板的参数先填掉。
 * 载荷缺了某个字段就不起：记一笔 `skipped`。spawn 失败（模板不存在、参数不合）也只记下来，不停住。
 */
const configSchema = z.object({
	template: z.string().min(1),
	params: z.record(z.string(), z.string().min(1)).default({}),
	trigger: z.string().min(1),
	eventId: z.string().min(1).optional(),
});

const stateSchema = z
	.object({ spawned: z.number(), skipped: z.number(), failed: z.number(), lastError: z.string().optional() })
	.default({ spawned: 0, skipped: 0, failed: 0 });

const field = (body: JsonValue, name: string): JsonValue | undefined =>
	typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, JsonValue>)[name] : undefined;

export const switchboard = defineNode({
	name: "switchboard",
	version: 1,
	state: stateSchema,
	config: configSchema,
	ports: () => ({}),
	step: ({ state, config, message }) => {
		if (message.type === "@effect.end") {
			const { result } = message.body as { result: { ok: boolean; error?: string } };
			if (result.ok) return { state };
			return { state: { ...state, failed: state.failed + 1, lastError: result.error ?? "spawn failed" } };
		}
		if (isReservedType(message.type)) return { state };

		const params: Record<string, JsonValue> = {};
		for (const [param, name] of Object.entries(config.params)) {
			const value = field(message.body, name);
			if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
				return { state: { ...state, skipped: state.skipped + 1 } };
			}
			params[param] = value;
		}
		const id = [config.template, ...Object.values(params).map(String)].join(":");
		const eventId = config.eventId === undefined ? undefined : field(message.body, config.eventId);
		const forward = {
			trigger: config.trigger,
			output: message.type,
			body: message.body,
			...(eventId === undefined || eventId === null ? {} : { eventId: String(eventId) }),
		};
		return {
			state: { ...state, spawned: state.spawned + 1 },
			effects: [{ kind: "workflow.spawn", input: { id, template: config.template, params, forward } }],
		};
	},
});
