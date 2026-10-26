import type { JsonValue } from "type-fest";
import {
	type Registry,
	type RunOptions,
	type SnapshotStore,
	type TransitionLog,
	deliverFromTrigger,
	deliverToNode,
} from "@arbetslag/kernel";
import { type DriveResult, type Performers, driveWorkflow } from "./executor.ts";
import { type KeyedQueue, createKeyedQueue } from "./queue.ts";
import { type Triggers, type TriggersOptions, createTriggers } from "./reconcile.ts";

/**
 * 一次部署里宿主那一侧的全部零件（`CONTEXT.md` 的「宿主」）。
 * 它只是把已经存在的东西装在一起，不新增抽象：没有 `recover()`、没有 `list()`——
 * 「谁需要恢复」是宿主自己的事（ADR-0003），不做成一个假装平台统一的接口。
 */
export type Host = {
	readonly store: SnapshotStore;
	readonly registry: Registry;
	readonly performers: Performers;
	/** 转移日志：旁路，可丢（ADR-0003）。 */
	readonly log?: TransitionLog;
	/** 串行入口的实现：同一份工作流的投递与推进不交错。 */
	readonly queue: KeyedQueue;
	/** 透传给每一次 `run` 的选项：预算、时钟、`effectId`。 */
	readonly run?: RunOptions;
	/** 触发器对账；配了 `triggers` 才有。进程退出前调 `stop()`。 */
	readonly triggers?: Triggers;
};

export type HostOptions = {
	store: SnapshotStore;
	registry: Registry;
	performers: Performers;
	log?: TransitionLog;
	queue?: KeyedQueue;
	run?: RunOptions;
	/** 配了它，宿主就在每次推进之后对账触发器（ADR-0001）。 */
	triggers?: Omit<TriggersOptions, "store" | "deliver">;
};

export function createHost(options: HostOptions): Host {
	const { triggers: triggerOptions, ...rest } = options;
	const bare: Host = { ...rest, queue: options.queue ?? createKeyedQueue() };
	if (triggerOptions === undefined) return bare;

	// 闭包里用 `host`：触发器的投递要回到宿主自己的入口（同一份工作流的串行入口）。
	const host: Host = {
		...bare,
		triggers: createTriggers({
			...triggerOptions,
			store: bare.store,
			deliver: (id, trigger, output, body) => submitFromTrigger(host, id, trigger, output, body),
		}),
	};
	return host;
}

/** 对账在推完之后、同一个串行入口里做：改图的回执已经落盘了（ADR-0001）。 */
async function reconcileTriggers(host: Host, id: string): Promise<void> {
	await host.triggers?.reconcile(id);
}

/**
 * 把一条消息交给某个节点，然后把工作流推到**静止**（ADR-0001：投递 = 一次写 + 一次 Run）。
 * 整个过程排在 `id` 那条队列上，与同一份工作流的其它投递与推进互斥。
 */
export async function submit(
	host: Host,
	id: string,
	node: string,
	message: { type: string; body: JsonValue },
): Promise<DriveResult> {
	return host.queue.add(id, async () => {
		await deliverToNode(host.store, id, node, message);
		const result = await driveWorkflow(host.store, host.registry, id, {
			performers: host.performers,
			run: host.run,
		});
		await reconcileTriggers(host, id);
		return result;
	});
}

/**
 * 触发器投进来一条事件（ADR-0001）：`output` 是触发器种类声明的输出名，
 * 沿从 `(trigger, output)` 出发的边走；没接线就丢弃（返回 `undefined`，不推进）。
 */
export async function submitFromTrigger(
	host: Host,
	id: string,
	trigger: string,
	output: string,
	body: JsonValue,
): Promise<DriveResult | undefined> {
	return host.queue.add(id, async () => {
		const delivered = await deliverFromTrigger(host.store, host.registry, id, trigger, output, body, {
			log: host.log,
		});
		if (!delivered) return undefined;
		const result = await driveWorkflow(host.store, host.registry, id, {
			performers: host.performers,
			run: host.run,
		});
		await reconcileTriggers(host, id);
		return result;
	});
}

/**
 * 只推进、不投递：给**恢复扫描**、以及 `resume` 之后用。
 * 快照里遗留的在飞**效果**由 `driveWorkflow` 先交出去。
 */
export function drive(host: Host, id: string): Promise<DriveResult> {
	return host.queue.add(id, async () => {
		const result = await driveWorkflow(host.store, host.registry, id, {
			performers: host.performers,
			run: host.run,
		});
		await reconcileTriggers(host, id);
		return result;
	});
}
