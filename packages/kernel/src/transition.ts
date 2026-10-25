import type { JsonValue } from "type-fest";
import type { EffectRequest } from "./effect/index.ts";
import type { Message } from "./message.ts";

/** 沿某个端口发出一条消息（ADR-0005）；`to` 只用于运行时新增的节点。 */
export type Send = {
	port: string;
	body: JsonValue;
	to?: string;
};

/**
 * step 的输入：这个节点此刻的一切（ADR-0004）。
 * `self` 是它自己的节点 id——改图时要把别的节点接回自己，只能靠它。
 */
export type StepInput<State, Config> = {
	self: string;
	config: Config;
	state: State;
	message: Message;
};

/**
 * 一条转移的产物。内核先校验再提交，整条不应用即停住（ADR-0008）。
 * 改图不在这里：它是 `graph.mutate` 效果（ADR-0002、0006），走 `effects`。
 */
export type Transition<State> = {
	state: State;
	sends?: Send[];
	effects?: EffectRequest[];
};
