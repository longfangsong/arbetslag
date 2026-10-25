import type { JsonValue } from "type-fest";
import type { z } from "zod";
import type { StepInput, Transition } from "./transition.ts";

export type NodeDefinition<State extends JsonValue, Config extends JsonValue> = {
	name: string;
	/**
	 * 快照里的节点状态由哪一版定义写下。内核只比较它、从不解释它：
	 * 记录版本落后 → `migrate`；超前（回滚部署）→ 停住。
	 */
	version: number;
	state: z.ZodType<State>;
	config: z.ZodType<Config>;
	/** config 的纯函数：`{ 端口名: body schema }`，内核据此校验接线与发送。 */
	ports(config: Config): Record<string, z.ZodType<JsonValue>>;
	/** 同步、无副作用资源；返回前内核会校验 state、sends、effects。 */
	step(input: StepInput<State, Config>): Transition<State>;
	/**
	 * 把旧版本写下的状态变成当前版本读得懂的状态：一次跳到当前版本，
	 * 只向前，总函数；输出由 `state` schema 校验。
	 */
	migrate?(state: JsonValue, fromVersion: number): State;
};

/** 注册表里装的是各种 State/Config 的定义，内核对它们一视同仁。 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyNodeDefinition = NodeDefinition<any, any>;

/** 只为类型推断：运行时原样返回。 */
export function defineNode<State extends JsonValue, Config extends JsonValue>(
	definition: NodeDefinition<State, Config>,
): NodeDefinition<State, Config> {
	return definition;
}
