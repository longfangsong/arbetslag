import type { JsonValue } from "type-fest";
import type { Trigger } from "@arbetslag/kernel";

/** 一个活着的监听。关掉之后宿主不会再管它。 */
export type TriggerHandle = { close(): Promise<void> };

export type TriggerHooks = {
	/**
	 * 投一条事件进来：`output` 必须是这个种类在 `outputs(config)` 里声明过的输出名，
	 * body 由内核按声明的 schema 校验（不合规就拒收，不停住）。
	 */
	deliver(output: string, body: JsonValue): Promise<unknown>;
	/**
	 * 监听一开始是好的、后来坏了（端口掉了、连接断了）。宿主记**未就绪**并重建。
	 * 起不来（`open` 失败）走抛错，不走这里。
	 */
	unready(reason: string): void;
};

/**
 * 一种**触发器种类**在宿主里的实现（`CONTEXT.md` 的「宿主」）。
 * 内核只存声明、校验 config，从不启动它；每个平台各写一份（Node 是 http/轮询，Workers 是 DO）。
 */
export type TriggerRuntime<Handle extends TriggerHandle = TriggerHandle> = {
	kind: string;
	open(declaration: Trigger, hooks: TriggerHooks): Promise<Handle>;
};

/** 注册表里的一种运行时；没有就是当前部署没实现这个 kind。 */
export type TriggerRuntimes = Readonly<Record<string, TriggerRuntime | undefined>>;

/** 声明合法但起不来：**未就绪**，不停住（ADR-0001）。 */
export class TriggerUnready extends Error {
	readonly trigger: string;
	/** 给未就绪报告用的一句话（不带 `trigger "x" is unready:` 前缀）。 */
	readonly reason: string;

	constructor(trigger: string, reason: string) {
		super(`trigger ${JSON.stringify(trigger)} is unready: ${reason}`);
		this.name = "TriggerUnready";
		this.trigger = trigger;
		this.reason = reason;
	}
}
