import type { JsonValue } from "type-fest";
import type { SnapshotStore, Trigger } from "@arbetslag/kernel";
import { type KeyedQueue, createKeyedQueue } from "./queue.ts";
import {
	type TriggerHandle,
	type TriggerHooks,
	type TriggerRuntimes,
	TriggerUnready,
} from "./triggers/runtime.ts";

export type Unready = { trigger: string; reason: string };

/** 一次对账的结果（ADR-0001：多了就起、少了就停、变了就重建）。 */
export type TriggerSync = {
	opened: string[];
	reopened: string[];
	closed: string[];
	unready: Unready[];
};

export type TriggersOptions = {
	store: SnapshotStore;
	/** 把事件投进工作流：通常是 `submitFromTrigger`。 */
	deliver(id: string, trigger: string, output: string, body: JsonValue): Promise<unknown>;
	runtimes: TriggerRuntimes;
	/** **未就绪**的重试间隔（毫秒）。省略或 0 = 只报告、不重试。 */
	retryMs?: number;
	onUnready?: (info: Unready & { id: string }) => void;
};

export type Triggers = {
	/**
	 * 读快照里当前的声明，和正在跑的监听对比：多则关、少则起、变则重建。
	 * 快照不在（`drop` 过）就把这份工作流的监听全关掉，返回 `undefined`。
	 */
	reconcile(id: string): Promise<TriggerSync | undefined>;
	/** 现在开着哪些（触发器 id）。 */
	running(id: string): string[];
	/** 现在哪些是**未就绪**的。它不是停住，不进快照。 */
	unready(id: string): Unready[];
	/** 关掉所有监听、停掉重试；进程退出前调。 */
	stop(): Promise<void>;
};

type Open = { fingerprint: string; handle: TriggerHandle };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 未就绪的原因：`TriggerUnready` 自己那句话，别人的异常用 message。 */
const reasonOf = (error: unknown): string =>
	error instanceof TriggerUnready ? error.reason : message(error);

/** 声明变没变：只看内核认的那两项。 */
const fingerprintOf = (declaration: Trigger): string =>
	JSON.stringify({ kind: declaration.kind, config: declaration.config });

/**
 * 触发器的对账（ADR-0001）：宿主的活。
 *
 * 每个平台的分叉都在 `TriggerRuntime` 那里，这一层只做「声明 vs 监听」的差集，
 * 所以它在 Node 与 Workers 上是同一段代码。
 */
export function createTriggers(options: TriggersOptions): Triggers {
	/** 同一份工作流的对账串行：重试定时器与投递可能同时到。 */
	const gates: KeyedQueue = createKeyedQueue();
	const running = new Map<string, Map<string, Open>>();
	const unready = new Map<string, Map<string, string>>();
	const retries = new Map<string, ReturnType<typeof setTimeout>>();

	function clearUnready(id: string, trigger: string): void {
		const map = unready.get(id);
		if (map === undefined) return;
		map.delete(trigger);
		if (map.size === 0) unready.delete(id);
	}

	function markUnready(id: string, trigger: string, reason: string): void {
		const map = unready.get(id) ?? new Map<string, string>();
		map.set(trigger, reason);
		unready.set(id, map);
		options.onUnready?.({ id, trigger, reason });
		scheduleRetry(id);
	}

	/** 未就绪只活在内存里：重试、上报，不进快照（ADR-0001）。 */
	function scheduleRetry(id: string): void {
		const retryMs = options.retryMs ?? 0;
		if (retryMs <= 0 || retries.has(id)) return;
		const timer = setTimeout(() => {
			retries.delete(id);
			void triggers.reconcile(id).catch(() => {});
		}, retryMs);
		// 只有未就绪等着重试时，别把进程钉住。
		timer.unref?.();
		retries.set(id, timer);
	}

	function stopRetry(id: string): void {
		const timer = retries.get(id);
		if (timer === undefined) return;
		clearTimeout(timer);
		retries.delete(id);
	}

	async function closeAll(id: string): Promise<string[]> {
		const open = running.get(id);
		if (open === undefined) return [];
		running.delete(id);
		unready.delete(id);
		stopRetry(id);
		const closed: string[] = [];
		for (const [trigger, entry] of open) {
			await entry.handle.close().catch(() => {});
			closed.push(trigger);
		}
		return closed;
	}

	async function syncOnce(id: string): Promise<TriggerSync | undefined> {
		const loaded = await options.store.load(id);
		if (loaded === undefined) {
			await closeAll(id);
			return undefined;
		}

		const open = running.get(id) ?? new Map<string, Open>();
		const declared = loaded.graph.shape.triggers;
		const seen = new Set<string>();
		const sync: TriggerSync = { opened: [], reopened: [], closed: [], unready: [] };

		for (const declaration of declared) {
			seen.add(declaration.id);
			const fingerprint = fingerprintOf(declaration);
			const existing = open.get(declaration.id);
			if (existing?.fingerprint === fingerprint) continue;

			if (existing !== undefined) {
				await existing.handle.close().catch(() => {});
				open.delete(declaration.id);
				sync.reopened.push(declaration.id);
			}

			const runtime = options.runtimes[declaration.kind];
			if (runtime === undefined) {
				markUnready(id, declaration.id, `no runtime for kind ${JSON.stringify(declaration.kind)}`);
				continue;
			}

			const hooks: TriggerHooks = {
				deliver: (output, body) => options.deliver(id, declaration.id, output, body),
				// 开着的时候坏了：先摘掉，等重试重建。
				unready: (reason) => {
					const entry = open.get(declaration.id);
					if (entry !== undefined) {
						open.delete(declaration.id);
						void entry.handle.close().catch(() => {});
					}
					markUnready(id, declaration.id, reason);
				},
			};

			try {
				const handle = await runtime.open(declaration, hooks);
				open.set(declaration.id, { fingerprint, handle });
				clearUnready(id, declaration.id);
				if (!sync.reopened.includes(declaration.id)) sync.opened.push(declaration.id);
			} catch (error) {
				markUnready(id, declaration.id, reasonOf(error));
			}
		}

		for (const trigger of [...open.keys()]) {
			if (seen.has(trigger)) continue;
			const entry = open.get(trigger);
			open.delete(trigger);
			await entry?.handle.close().catch(() => {});
			sync.closed.push(trigger);
		}

		if (open.size > 0) running.set(id, open);
		else running.delete(id);

		for (const [trigger, reason] of unready.get(id) ?? new Map<string, string>()) {
			sync.unready.push({ trigger, reason });
		}
		if (!unready.has(id)) stopRetry(id);

		return sync;
	}

	const triggers: Triggers = {
		reconcile: (id) => gates.add(id, () => syncOnce(id)),

		running: (id) => [...(running.get(id)?.keys() ?? [])],

		unready: (id) => [...(unready.get(id) ?? new Map<string, string>())].map(([trigger, reason]) => ({
			trigger,
			reason,
		})),

		async stop() {
			for (const id of [...retries.keys()]) stopRetry(id);
			for (const id of [...running.keys()]) await closeAll(id);
			unready.clear();
		},
	};

	return triggers;
}
