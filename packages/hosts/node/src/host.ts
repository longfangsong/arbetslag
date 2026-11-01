import type { JsonValue } from "type-fest";
import {
	InvalidDelivery,
	type InFlightEffect,
	type LogEntry,
	type Registry,
	type RunOptions,
	type Snapshot,
	type TransitionLog,
	WorkflowNotFound,
	appendLog,
	applyTriggerDelivery,
	completeEffect,
	deliverToNode,
	graphMutateEffect,
	instantiate,
	performGraphMutate,
	resume as resumeWorkflow,
	run,
	selectSubscribers,
	workflowSpawnEffect,
	workflowSpawnInputSchema,
} from "@arbetslag/kernel";
import {
	DEFAULT_PERFORMER_TIMEOUT_MS,
	MissingPerformer,
	type Performer,
	type Performers,
	failure,
	perform,
} from "./executor.ts";
import type { Listener, ListenerEvent, ListenerHandle, ListenerRuntimes } from "./listeners/runtime.ts";
import { ListenerUnready } from "./listeners/runtime.ts";
import { createKeyedQueue } from "./queue.ts";
import type { OutboxEntry, SqliteStore, SubscriptionRow } from "./sqliteStore.ts";

/** 宿主侧的护栏：一次推进最多跑几轮 `run`。内核不区分"静止"与"死锁"，跑不动的图得有人喊停。 */
export const DEFAULT_MAX_ROUNDS = 1000;
/** 路由发件箱的保留期：大于来源的重投窗口（ADR-0015）。 */
export const DEFAULT_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 声明合法、但还没生效（`CONTEXT.md` 的「未就绪」）：不停住、不进快照，宿主重试并上报。
 * - `listener`：监听器起不来（token 被拒、端口被占），或部署里没有它的实现；
 * - `trigger`：触发器引用的监听器不在部署里。
 */
export type Unready =
	| { scope: "listener"; listener: string; reason: string }
	| { scope: "trigger"; workflowId: string; trigger: string; reason: string };

/** 宿主吞下、但要让人看见的错误：Performer 缺席、匹配函数抛错、路由写失败…… */
export type HostError = { error: unknown; workflowId?: string; effectId?: string; listener?: string };

export type HostOptions = {
	store: SqliteStore;
	registry: Registry;
	performers: Performers;
	/** 转移日志：旁路，可丢（ADR-0003）。 */
	log?: TransitionLog;
	/** 透传给每一次 `run`：预算、时钟、`effectId`。 */
	run?: RunOptions;
	maxRounds?: number;
	/** Performer 的默认时限（ADR-0014）；必须小于 15 分钟。 */
	performerTimeoutMs?: number;
	/** 按效果种类覆盖时限。 */
	timeouts?: Readonly<Record<string, number>>;
	/** 部署里的监听器（ADR-0015）：一个外部事件源一个。 */
	listeners?: readonly Listener[];
	runtimes?: ListenerRuntimes;
	/** 监听器**未就绪**的重试间隔（毫秒）。省略或 0 = 只报告、不重试。 */
	retryMs?: number;
	onUnready?: (info: Unready) => void;
	/** 默认打到 stderr。 */
	onError?: (info: HostError) => void;
};

/**
 * 一次推进（`submit` / `drive` / `drain` 的同步部分）的结果。效果在它返回时已经交出去了，
 * 但还没回来：回执由激活在后台落盘，`idle()` 等它们全部结束。
 *
 * - `quiescent`：邮箱空了（可能仍有在飞效果）
 * - `halted`：停住，不再交出新的效果
 * - `rounds`：撞上宿主的轮数上限（不是停住）
 */
export type Advance = {
	status: "quiescent" | "halted" | "rounds";
	rounds: number;
	steps: number;
	/** 这次交给 Performer 的效果条数（`graph.mutate` 在推进里就地执行，不算）。 */
	dispatched: number;
};

export type RouteReport = {
	/** 收到这条事件的工作流（去重之后也算：它们在发件箱里有这一行）。 */
	targets: string[];
	/** 真正新写进发件箱的行数；来源重投同一个 `eventId` 时是 0。 */
	enqueued: number;
};

export type RecoveryReport = {
	scanned: number;
	/** 重新交出的在飞效果条数（换激活的唯一重复来源，ADR-0014）。 */
	redispatched: number;
	/** 停住：不推进、不交出效果，等人 `resume`。 */
	halted: string[];
	failed: { id: string; error: unknown }[];
};

/**
 * 一次激活（ADR-0014）：对它打开的存储里每一份工作流负责的那一个执行上下文。
 *
 * - **串行入口只包住存储事务**：投递、`run`、落回执、改图、消费发件箱，各排一次队；
 *   Performer 在队列之外跑，模型在想的时候新消息照常推进。
 * - **交出至多一次**：内存里的"正在执行"集合；只有激活启动（`recover`）与 `resume` 会重扫 `inFlight`。
 * - **路由**（ADR-0015）：监听器交来的事件按订阅写进发件箱，目标的激活再按游标拉进邮箱。
 */
export type Host = {
	readonly store: SqliteStore;
	readonly registry: Registry;
	/** 直接投给某个节点，然后推进（ADR-0001：投递 = 一次写 + 一次 Run）。 */
	submit(id: string, node: string, message: { type: string; body: JsonValue }): Promise<Advance>;
	/** 只推进，不投递。 */
	drive(id: string): Promise<Advance>;
	/** 把发件箱里比游标新的行投进邮箱（与推进游标同一次事务），然后推进。 */
	drain(id: string): Promise<Advance>;
	/** 路由一条外部事件（监听器调它；测试与命令行也可以直接调）。resolve 时已写进发件箱。 */
	emit(listener: string, event: ListenerEvent): Promise<RouteReport>;
	/** 解除停住（ADR-0008），把留在快照里的在飞效果交出去，再消费发件箱、推进。 */
	resume(id: string): Promise<boolean>;
	/** 激活启动：重建路由索引、交出全部在飞效果、消费发件箱（恢复扫描）。 */
	recover(): Promise<RecoveryReport>;
	/** `recover` 之后打开监听器。 */
	start(): Promise<RecoveryReport>;
	/** 等到没有正在执行的效果、没有排队的推进。 */
	idle(): Promise<void>;
	/** 关掉监听器、停掉重试。不等在飞的效果（用 `idle()`），不关存储。 */
	stop(): Promise<void>;
	/** 这份工作流此刻正在执行的 `effectId`。 */
	executing(id: string): string[];
	unready(): Unready[];
	/** 清掉过了保留期的发件箱行。 */
	prune(retentionMs?: number): Promise<number>;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 一份快照里的触发器声明 → 路由索引的行（对账的目标状态）。 */
function subscriptionsOf(workflowId: string, snapshot: Snapshot): SubscriptionRow[] {
	return snapshot.graph.shape.triggers.map((trigger) => ({
		workflowId,
		trigger: trigger.id,
		listener: trigger.listener,
		kind: trigger.kind,
		config: trigger.config,
		...(trigger.match === undefined ? {} : { match: trigger.match }),
		group: trigger.group,
		priority: trigger.priority,
	}));
}

export function createHost(options: HostOptions): Host {
	const { store, registry } = options;
	const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
	const queue = createKeyedQueue();
	const executing = new Map<string, Set<string>>();
	const background = new Set<Promise<void>>();
	const listeners = new Map((options.listeners ?? []).map((listener) => [listener.id, listener]));
	const handles = new Map<string, ListenerHandle>();
	const retries = new Map<string, ReturnType<typeof setTimeout>>();
	const listenerUnready = new Map<string, string>();
	const triggerUnready = new Map<string, Map<string, string>>();
	let stopped = false;

	const onError =
		options.onError ??
		((info: HostError) => {
			console.error("[arbetslag]", info.workflowId ?? info.listener ?? "", describe(info.error));
		});
	const report = (info: HostError) => {
		try {
			onError(info);
		} catch {
			// 上报自己出错不能拖垮激活
		}
	};

	/** 后台工作：从不 reject（错误走 `onError`），`idle()` 等它们。 */
	function track(work: () => Promise<unknown>, context: Omit<HostError, "error"> = {}): void {
		const promise = work().then(
			() => {},
			(error: unknown) => report({ ...context, error }),
		);
		background.add(promise);
		void promise.finally(() => background.delete(promise));
	}

	// ── 推进（都在串行入口里） ────────────────────────────────────────────────

	/** `run` 到没得推：改图就地执行（它就是一次存储事务），其余效果交给 Performer。 */
	async function advanceLocked(id: string): Promise<Advance> {
		let rounds = 0;
		let steps = 0;
		let dispatched = 0;
		for (;;) {
			const outcome = await run(store, registry, id, options.run);
			rounds++;
			steps += outcome.steps;
			if (outcome.status === "halted") return { status: "halted", rounds, steps, dispatched };

			let mutated = false;
			for (const effect of outcome.effects) {
				if (effect.kind === graphMutateEffect.kind) {
					await performGraphMutate(store, registry, id, effect.effectId);
					mutated = true;
				} else if (dispatch(id, effect)) {
					dispatched++;
				}
			}
			if (!mutated && outcome.status === "quiescent") return { status: "quiescent", rounds, steps, dispatched };
			if (rounds >= maxRounds) return { status: "rounds", rounds, steps, dispatched };
		}
	}

	/** 对账（ADR-0015）：快照里的触发器声明 → 路由索引；引用部署里没有的监听器 → 未就绪。 */
	async function reconcile(id: string): Promise<void> {
		const loaded = await store.load(id);
		const rows = loaded === undefined ? [] : subscriptionsOf(id, loaded);
		await store.replaceSubscriptions(id, rows);

		const before = triggerUnready.get(id) ?? new Map<string, string>();
		const after = new Map<string, string>();
		for (const row of rows) {
			if (listeners.has(row.listener)) continue;
			const reason = `no listener ${JSON.stringify(row.listener)} in this deployment`;
			after.set(row.trigger, reason);
			if (before.get(row.trigger) !== reason) {
				options.onUnready?.({ scope: "trigger", workflowId: id, trigger: row.trigger, reason });
			}
		}
		if (after.size > 0) triggerUnready.set(id, after);
		else triggerUnready.delete(id);
	}

	/** 一项串行工作：做 `first`，推进，对账。 */
	function locked(id: string, first?: () => Promise<unknown>): Promise<Advance> {
		return queue.add(id, async () => {
			await first?.();
			const advanced = await advanceLocked(id);
			await reconcile(id);
			return advanced;
		});
	}

	/** 发件箱 → 邮箱，与推进游标同一次事务；停住时不消费（ADR-0015）。 */
	async function drainLocked(id: string): Promise<void> {
		const dropped: LogEntry[] = [];
		const at = new Date().toISOString();
		await store.drain(id, (snapshot, rows) => {
			if (snapshot.halted !== undefined) return { consumed: false, value: undefined };
			if (rows.length === 0) return { consumed: true, value: undefined };
			for (const row of rows) {
				try {
					if (!applyTriggerDelivery(registry, id, snapshot, row.trigger, row.output, row.body)) {
						dropped.push({ type: "dropped", from: row.trigger, port: row.output, reason: "no_edge", at });
					}
				} catch (error) {
					// 路由之后触发器被删了、或种类换了：这一行投不进去，丢弃并记日志，不挡后面的行。
					if (!(error instanceof InvalidDelivery)) throw error;
					dropped.push({ type: "dropped", from: row.trigger, port: row.output, reason: "rejected", at });
				}
			}
			return { snapshot, consumed: true, value: undefined };
		});
		await appendLog(options.log, id, dropped);
	}

	// ── 效果 ──────────────────────────────────────────────────────────────────

	/** 交出一条效果；同一激活里同一个 `effectId` 至多一次（ADR-0014 的 C2）。返回是否真的交出。 */
	function dispatch(id: string, effect: InFlightEffect): boolean {
		const running = executing.get(id) ?? new Set<string>();
		if (running.has(effect.effectId)) return false;
		const performer = performerFor(effect.kind);
		if (performer === undefined) {
			report({ workflowId: id, effectId: effect.effectId, error: new MissingPerformer(effect.kind) });
			return false;
		}
		running.add(effect.effectId);
		executing.set(id, running);

		const timeoutMs = options.timeouts?.[effect.kind] ?? options.performerTimeoutMs ?? DEFAULT_PERFORMER_TIMEOUT_MS;
		track(
			async () => {
				try {
					const result = await perform(performer, { workflowId: id, effect }, timeoutMs);
					await locked(id, () => completeEffect(store, id, effect.effectId, result)).catch((error: unknown) => {
						// 工作流在等待期间被删了：结果没有去处。
						if (!(error instanceof WorkflowNotFound)) throw error;
					});
				} finally {
					running.delete(effect.effectId);
					if (running.size === 0) executing.delete(id);
				}
			},
			{ workflowId: id, effectId: effect.effectId },
		);
		return true;
	}

	function performerFor(kind: string): Performer | undefined {
		return kind === workflowSpawnEffect.kind ? spawn : options.performers[kind];
	}

	/**
	 * `workflow.spawn`（ADR-0015）：实例化（已存在就跳过），并在一次原子写里落下新工作流的索引行
	 * 与转交的那一行发件箱；然后让目标的激活去消费。
	 */
	const spawn: Performer = async (input) => {
		const { id, template, forward } = workflowSpawnInputSchema.parse(input);
		let snapshot: Snapshot;
		try {
			snapshot = instantiate(registry, template);
		} catch (error) {
			return failure(error);
		}
		const existing = await store.load(id);
		const target = existing ?? snapshot;
		let entry: OutboxEntry | undefined;
		if (forward !== undefined) {
			const listener = target.graph.shape.triggers.find((t) => t.id === forward.trigger)?.listener ?? "";
			entry = { target: id, listener, ...forward };
		}
		const { created } = await store.spawn(id, snapshot, subscriptionsOf(id, snapshot), entry);
		track(() => host.drain(id), { workflowId: id });
		return { ok: true, created };
	};

	/** 留在快照里的在飞效果：改图就地执行，其余交出（跳过正在执行的）。 */
	async function settleLeftovers(id: string, snapshot: Snapshot): Promise<number> {
		let redispatched = 0;
		for (const effect of snapshot.inFlight) {
			if (effect.kind === graphMutateEffect.kind) {
				await queue.add(id, () => performGraphMutate(store, registry, id, effect.effectId));
			} else if (dispatch(id, effect)) {
				redispatched++;
			}
		}
		return redispatched;
	}

	// ── 监听器 ────────────────────────────────────────────────────────────────

	function markListenerUnready(listener: string, reason: string): void {
		if (listenerUnready.get(listener) !== reason) {
			listenerUnready.set(listener, reason);
			options.onUnready?.({ scope: "listener", listener, reason });
		}
		const retryMs = options.retryMs ?? 0;
		if (retryMs <= 0 || stopped || retries.has(listener)) return;
		const timer = setTimeout(() => {
			retries.delete(listener);
			void openListener(listener);
		}, retryMs);
		timer.unref?.();
		retries.set(listener, timer);
	}

	async function openListener(id: string): Promise<void> {
		const listener = listeners.get(id);
		if (listener === undefined || stopped || handles.has(id)) return;
		const runtime = options.runtimes?.[listener.kind];
		if (runtime === undefined) {
			markListenerUnready(id, `no runtime for kind ${JSON.stringify(listener.kind)}`);
			return;
		}
		try {
			const handle = await runtime.open(listener, {
				emit: (event) => host.emit(id, event),
				unready: (reason) => {
					const open = handles.get(id);
					handles.delete(id);
					void open?.close().catch(() => {});
					markListenerUnready(id, reason);
				},
			});
			if (stopped) {
				await handle.close();
				return;
			}
			handles.set(id, handle);
			listenerUnready.delete(id);
		} catch (error) {
			markListenerUnready(id, error instanceof ListenerUnready ? error.reason : describe(error));
		}
	}

	// ── 对外 ──────────────────────────────────────────────────────────────────

	const host: Host = {
		store,
		registry,

		submit: (id, node, message) => locked(id, () => deliverToNode(store, id, node, message)),

		drive: (id) => locked(id),

		drain: (id) => locked(id, () => drainLocked(id)),

		async emit(listenerId, event) {
			const listener = listeners.get(listenerId);
			if (listener === undefined) throw new Error(`no listener ${JSON.stringify(listenerId)} in this deployment`);

			const candidates = (await store.subscriptions(listenerId)).filter((subscription) => {
				if (subscription.kind !== listener.kind) return false;
				const kind = registry.triggerKind(subscription.kind);
				const config = kind?.config.safeParse(subscription.config);
				const schema = config?.success === true ? kind?.outputs(config.data)[event.output] : undefined;
				// 这条订阅不收这个输出：不是候选。
				if (schema === undefined) return false;
				if (schema.safeParse(event.body).success) return true;
				report({
					listener: listenerId,
					workflowId: subscription.workflowId,
					error: new InvalidDelivery(`body does not match output ${JSON.stringify(event.output)}`),
				});
				return false;
			});

			const selection = selectSubscribers(registry, candidates, { output: event.output, body: event.body });
			for (const failed of selection.failures) {
				report({ listener: listenerId, workflowId: failed.subscription.workflowId, error: failed.error });
			}

			const entries: OutboxEntry[] = selection.targets.map((subscription) => ({
				target: subscription.workflowId,
				trigger: subscription.trigger,
				output: event.output,
				body: event.body,
				listener: listenerId,
				...(event.eventId === undefined ? {} : { eventId: event.eventId }),
			}));
			const enqueued = await store.enqueue(entries);

			const targets = [...new Set(entries.map((entry) => entry.target))];
			for (const target of targets) track(() => host.drain(target), { workflowId: target });
			return { targets, enqueued };
		},

		async resume(id) {
			const resumed = await queue.add(id, () => resumeWorkflow(store, id));
			if (!resumed) return false;
			const loaded = await store.load(id);
			if (loaded !== undefined) await settleLeftovers(id, loaded);
			await host.drain(id);
			return true;
		},

		async recover() {
			const result: RecoveryReport = { scanned: 0, redispatched: 0, halted: [], failed: [] };
			const ids = await store.ids();
			result.scanned = ids.length;
			for (const id of ids) {
				try {
					await queue.add(id, () => reconcile(id));
					const loaded = await store.load(id);
					if (loaded === undefined) continue;
					if (loaded.halted !== undefined) {
						result.halted.push(id);
						continue;
					}
					result.redispatched += await settleLeftovers(id, loaded);
					await host.drain(id);
				} catch (error) {
					result.failed.push({ id, error });
				}
			}
			return result;
		},

		async start() {
			stopped = false;
			const recovered = await host.recover();
			for (const id of listeners.keys()) await openListener(id);
			return recovered;
		},

		async idle() {
			while (background.size > 0) await Promise.allSettled([...background]);
		},

		async stop() {
			stopped = true;
			for (const timer of retries.values()) clearTimeout(timer);
			retries.clear();
			const open = [...handles.values()];
			handles.clear();
			await Promise.allSettled(open.map((handle) => handle.close()));
		},

		executing: (id) => [...(executing.get(id) ?? [])],

		unready: () => [
			...[...listenerUnready].map(([listener, reason]): Unready => ({ scope: "listener", listener, reason })),
			...[...triggerUnready].flatMap(([workflowId, map]) =>
				[...map].map(([trigger, reason]): Unready => ({ scope: "trigger", workflowId, trigger, reason })),
			),
		],

		prune: (retentionMs = DEFAULT_OUTBOX_RETENTION_MS) => store.pruneOutbox(Date.now() - retentionMs),
	};

	return host;
}
