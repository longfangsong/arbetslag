import type { JsonValue } from "type-fest";
import {
	type CreateWorkflowOptions,
	InvalidDelivery,
	type InFlightEffect,
	type LogEntry,
	type Registry,
	type RunOptions,
	type Snapshot,
	type TransitionLog,
	WorkflowExists,
	WorkflowNotFound,
	type WorkflowTemplate,
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
import { type OutboxEntry, type SqliteStore, type SubscriptionRow, subscriptionsOf } from "./sqliteStore.ts";
import { createWorkingCopies } from "./workingCopy.ts";

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

/**
 * 激活里有东西变了：只带 id，不带快照，观察者要什么自己去读（`snapshot`、`executing`、`unready`）。
 * - `workflow`：这份工作流的工作副本或检查点可能变了，或者它正在执行的效果多了、少了；
 * - `unready`：**未就绪**的那张表变了。
 * 可能多报（一次推进什么都没改也会报），不会漏报。
 */
export type HostChange = { scope: "workflow"; id: string } | { scope: "unready" };

/** 宿主吞下、但要让人看见的错误：Performer 缺席、匹配函数抛错、路由写失败…… */
export type HostError = { error: unknown; workflowId?: string; effectId?: string; listener?: string };

/** 模板目录（ADR-0018）：模板名 → 模板。`workflow.spawn` 按名字从这里取。 */
export type Templates = Readonly<Record<string, WorkflowTemplate | undefined>>;

export type HostOptions = {
	store: SqliteStore;
	registry: Registry;
	performers: Performers;
	/** 模板目录；省略即空，`workflow.spawn` 一律回执失败。 */
	templates?: Templates;
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
 * 但还没回来：回执由激活在后台落进工作副本，`idle()` 等它们全部结束。
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
 * - **串行入口只包住工作副本上的改动**：投递、`run`、落回执、改图、消费发件箱，各排一次队；
 *   Performer 在队列之外跑，模型在想的时候新消息照常推进。
 * - **只在三个时刻写检查点**（ADR-0016）：确认直接投递或 `resume` 之前、交出不可重放的效果之前、
 *   闲下来之前（静止或停住，且没有可重放的效果还在执行）。其余改动只在工作副本里。
 * - **交出至多一次**：内存里的"正在执行"集合；只有激活启动（`recover`）与 `resume` 会重扫 `inFlight`。
 * - **路由**（ADR-0015）：监听器交来的事件按订阅写进发件箱，目标的激活再按游标拉进邮箱。
 */
export type Host = {
	readonly store: SqliteStore;
	readonly registry: Registry;
	readonly templates: Templates;
	/** 这份工作流此刻的快照：工作副本里的那份（比存储新），或者存储里的上一个检查点。 */
	snapshot(id: string): Promise<Snapshot | undefined>;
	/**
	 * 实例化一份新工作流：快照与它的路由索引行在一次事务里落盘（与 `workflow.spawn` 同一次写，ADR-0015）。
	 * id 不给就随机生成；`params` 填模板参数（ADR-0018）。已存在抛 `WorkflowExists`，
	 * 模板或参数不合规抛 `InstantiateError`。
	 */
	create(template: WorkflowTemplate, options?: CreateWorkflowOptions): Promise<{ id: string }>;
	/** 观察激活里的变化（ADR-0017），返回取消函数。回调同步跑在推进的路径上，要快；它抛错被吞掉。 */
	watch(onChange: (change: HostChange) => void): () => void;
	/** 直接投给某个节点，然后推进（ADR-0001）。返回之前这条消息已经落盘（ADR-0016 的 W1）。 */
	submit(id: string, node: string, message: { type: string; body: JsonValue }): Promise<Advance>;
	/** 只推进，不投递。 */
	drive(id: string): Promise<Advance>;
	/** 把发件箱里比游标新的行投进邮箱（游标跟着下一个检查点落盘），然后推进。 */
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

/** 推到没得推之后、交出之前：效果攒在这里，由 `settle` 决定先不先写检查点。 */
type Pushed = { status: Advance["status"]; rounds: number; steps: number; effects: InFlightEffect[] };

export function createHost(options: HostOptions): Host {
	const { store, registry } = options;
	const templates = options.templates ?? {};
	const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
	const copies = createWorkingCopies(store);
	const queue = createKeyedQueue();
	/** 正在执行的效果：`effectId` → 是否可重放（ADR-0016 的 W2 要看）。 */
	const executing = new Map<string, Map<string, boolean>>();
	const background = new Set<Promise<void>>();
	const listeners = new Map((options.listeners ?? []).map((listener) => [listener.id, listener]));
	const handles = new Map<string, ListenerHandle>();
	const retries = new Map<string, ReturnType<typeof setTimeout>>();
	const listenerUnready = new Map<string, string>();
	const triggerUnready = new Map<string, Map<string, string>>();
	const watchers = new Set<(change: HostChange) => void>();
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

	function notify(change: HostChange): void {
		for (const watcher of watchers) {
			try {
				watcher(change);
			} catch {
				// 观察者出错不能拖垮激活
			}
		}
	}

	/** 串行入口里的一项工作；做完（成功或失败）都报一次这份工作流变了。 */
	function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
		return queue.add(id, work).finally(() => notify({ scope: "workflow", id }));
	}

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

	const replayable = (kind: string): boolean => registry.effectKind(kind)?.replayable === true;

	/** `run` 到没得推：改图就地执行（改的是工作副本），其余效果攒着，交不交、何时交由 `settle` 定。 */
	async function push(id: string): Promise<Pushed> {
		let rounds = 0;
		let steps = 0;
		const effects: InFlightEffect[] = [];
		for (;;) {
			const outcome = await run(copies, registry, id, options.run);
			rounds++;
			steps += outcome.steps;
			if (outcome.status === "halted") return { status: "halted", rounds, steps, effects };

			let mutated = false;
			for (const effect of outcome.effects) {
				if (effect.kind === graphMutateEffect.kind) {
					await performGraphMutate(copies, registry, id, effect.effectId);
					mutated = true;
				} else {
					effects.push(effect);
				}
			}
			if (!mutated && outcome.status === "quiescent") return { status: "quiescent", rounds, steps, effects };
			if (rounds >= maxRounds) return { status: "rounds", rounds, steps, effects };
		}
	}

	/**
	 * 推完之后（ADR-0016）：该写检查点就先写，再交出效果。写的条件是三者之一——
	 * - `durable`：调用方要确认一条不在别处落盘的输入（W1）；
	 * - 要交出的效果里有不可重放的（W3）；
	 * - 闲下来了：停在一个点上（静止、停住、轮数上限），且没有可重放的效果还在执行（W2）。
	 * 停住时不交出新的效果：它们留在 `inFlight` 里，`resume` 之后再交（ADR-0008）。
	 */
	async function settle(id: string, pushed: Pushed, durable: boolean): Promise<Advance> {
		const effects = pushed.status === "halted" ? [] : pushed.effects;
		const busy = effects.some((e) => replayable(e.kind)) || [...(executing.get(id)?.values() ?? [])].some(Boolean);
		if (durable || effects.some((e) => !replayable(e.kind)) || pushed.status !== "quiescent" || !busy) {
			await checkpoint(id);
		}
		let dispatched = 0;
		for (const effect of effects) if (dispatch(id, effect)) dispatched++;
		return { status: pushed.status, rounds: pushed.rounds, steps: pushed.steps, dispatched };
	}

	/** 写检查点；触发器变了，路由索引已在同一次事务里重写，这里只重算未就绪。 */
	async function checkpoint(id: string): Promise<void> {
		const { subscriptions } = await copies.checkpoint(id);
		if (subscriptions !== undefined) noteUnready(id, subscriptions);
	}

	/** 对账（ADR-0015）：快照里的触发器声明 → 路由索引。激活启动时做一次，之后跟着检查点走。 */
	async function reconcile(id: string): Promise<void> {
		const loaded = await copies.load(id);
		const rows = loaded === undefined ? [] : subscriptionsOf(id, loaded);
		await store.replaceSubscriptions(id, rows);
		noteUnready(id, rows);
	}

	/** 引用部署里没有的监听器的触发器 → 未就绪；只在变化时上报。 */
	function noteUnready(id: string, rows: SubscriptionRow[]): void {
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
		const changed = before.size !== after.size || [...after].some(([trigger, reason]) => before.get(trigger) !== reason);
		if (after.size > 0) triggerUnready.set(id, after);
		else triggerUnready.delete(id);
		if (changed) notify({ scope: "unready" });
	}

	/** 一项串行工作：做 `first`，推进，按 ADR-0016 决定写不写检查点，交出效果。 */
	function locked(id: string, first?: () => Promise<unknown>, durable = false): Promise<Advance> {
		return serial(id, async () => {
			await first?.();
			return settle(id, await push(id), durable);
		});
	}

	/** 发件箱 → 邮箱，游标在工作副本里前进；停住时不消费（ADR-0015）。 */
	async function drainLocked(id: string): Promise<void> {
		const dropped: LogEntry[] = [];
		const at = new Date().toISOString();
		await copies.drain(id, (snapshot, rows) => {
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
		const running = executing.get(id) ?? new Map<string, boolean>();
		if (running.has(effect.effectId)) return false;
		const performer = performerFor(effect.kind);
		if (performer === undefined) {
			report({ workflowId: id, effectId: effect.effectId, error: new MissingPerformer(effect.kind) });
			return false;
		}
		running.set(effect.effectId, replayable(effect.kind));
		executing.set(id, running);
		notify({ scope: "workflow", id });

		const timeoutMs = options.timeouts?.[effect.kind] ?? options.performerTimeoutMs ?? DEFAULT_PERFORMER_TIMEOUT_MS;
		track(
			async () => {
				try {
					const result = await perform(performer, { workflowId: id, effect }, timeoutMs);
					const settled = async () => {
						await completeEffect(copies, id, effect.effectId, result);
						// 回执已在工作副本里：它不再算"在执行"，W2 要看见这一点。
						running.delete(effect.effectId);
					};
					await locked(id, settled).catch((error: unknown) => {
						// 工作流在等待期间被删了：结果没有去处。
						if (!(error instanceof WorkflowNotFound)) throw error;
					});
				} finally {
					running.delete(effect.effectId);
					if (running.size === 0) executing.delete(id);
					notify({ scope: "workflow", id });
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
	 * `workflow.spawn`（ADR-0015、0018）：按名字从模板目录取模板、填参数、实例化（已存在就跳过），
	 * 并在一次原子写里落下新工作流的索引行与转交的那一行发件箱；然后让目标的激活去消费。
	 * 模板不存在、参数或模板不合规都是失败回执。
	 */
	const spawn: Performer = async (input) => {
		const { id, template: name, params, forward } = workflowSpawnInputSchema.parse(input);
		const template = templates[name];
		if (template === undefined) return failure(new Error(`no template ${JSON.stringify(name)}`));
		let snapshot: Snapshot;
		try {
			snapshot = instantiate(registry, template, params);
		} catch (error) {
			return failure(error);
		}
		const existing = await copies.load(id);
		const target = existing ?? snapshot;
		let entry: OutboxEntry | undefined;
		if (forward !== undefined) {
			const listener = target.graph.shape.triggers.find((t) => t.id === forward.trigger)?.listener ?? "";
			entry = { target: id, listener, ...forward };
		}
		const rows = subscriptionsOf(id, snapshot);
		const { created } = await store.spawn(id, snapshot, rows, entry);
		if (created) {
			noteUnready(id, rows);
			notify({ scope: "workflow", id });
		}
		track(() => host.drain(id), { workflowId: id });
		return { ok: true, created };
	};

	/** 留在快照里的在飞效果：改图就地执行，其余交出（跳过正在执行的）。 */
	async function settleLeftovers(id: string, snapshot: Snapshot): Promise<number> {
		let redispatched = 0;
		for (const effect of snapshot.inFlight) {
			if (effect.kind === graphMutateEffect.kind) {
				await serial(id, () => performGraphMutate(copies, registry, id, effect.effectId));
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
			notify({ scope: "unready" });
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
			if (listenerUnready.delete(id)) notify({ scope: "unready" });
		} catch (error) {
			markListenerUnready(id, error instanceof ListenerUnready ? error.reason : describe(error));
		}
	}

	// ── 对外 ──────────────────────────────────────────────────────────────────

	const host: Host = {
		store,
		registry,
		templates,

		snapshot: (id) => copies.load(id),

		async create(template, { id = crypto.randomUUID(), params } = {}) {
			const snapshot = instantiate(registry, template, params);
			const rows = subscriptionsOf(id, snapshot);
			await serial(id, async () => {
				const { created } = await store.spawn(id, snapshot, rows);
				if (!created) throw new WorkflowExists(id);
				noteUnready(id, rows);
			});
			return { id };
		},

		watch(onChange) {
			watchers.add(onChange);
			return () => {
				watchers.delete(onChange);
			};
		},

		submit: (id, node, message) => locked(id, () => deliverToNode(copies, id, node, message), true),

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
			const resumed = await serial(id, async () => {
				const cleared = await resumeWorkflow(copies, id);
				// `resume` 返回之前，解除停住已经落盘（W1）。
				if (cleared) await checkpoint(id);
				return cleared;
			});
			if (!resumed) return false;
			const loaded = await copies.load(id);
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
					await serial(id, () => reconcile(id));
					const loaded = await copies.load(id);
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

		executing: (id) => [...(executing.get(id)?.keys() ?? [])],

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
