import type { JsonValue } from "type-fest";
import {
	type InFlightEffect,
	type Registry,
	type RunOptions,
	type SnapshotStore,
	WorkflowNotFound,
	completeEffect,
	graphMutateEffect,
	performGraphMutate,
	run,
} from "@arbetslag/kernel";

/**
 * 一种**效果种类**在宿主里的实现（`CONTEXT.md` 的「宿主」）：宿主按平台各写一份，
 * 内核不认识它、只认注册表里的 schema。拿 `input`，把外部世界的结果作为 `result` 交回——
 * 成功与失败都是结果（ADR-0006）。
 */
export type PerformContext = {
	workflowId: string;
	/** 整条在飞记录：`effectId` 是内核的幂等键，`correlationId` 是作者给的配对键。 */
	effect: InFlightEffect;
};

export type Performer = (
	input: JsonValue,
	context: PerformContext,
) => JsonValue | Promise<JsonValue>;

/** 按效果种类查对应的 **Performer**；缺的那一种就是当前部署没实现它。 */
export type Performers = Readonly<Record<string, Performer | undefined>>;

/**
 * 部署错误：快照里有在飞效果，但这个部署没有它的 **Performer**。
 * 不是停住（ADR-0008）——记录原样留在快照里，补上 Performer 的部署会再捡起它。
 */
export class MissingPerformer extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`no performer for effect kind ${JSON.stringify(kind)}`);
		this.name = "MissingPerformer";
		this.kind = kind;
	}
}

/**
 * **Performer** 抛错时回给节点的结果（宿主约定）：失败是正常结果，不是内核故障。
 * 效果种类的 `result` schema 应当接受它；不接受就在 Performer 里把错误转成自己的形状再返回。
 */
function failure(error: unknown): JsonValue {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/** 一批效果的执行与回执。返回真正落了回执的条数。 */
async function settleRound(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	performers: Performers,
	effects: InFlightEffect[],
): Promise<number> {
	let settled = 0;

	// 改图先落：它的“执行”就是内核导出的那个纯函数 + 一次 CAS 写（ADR-0002、ADR-0006）。
	// 调用的是执行器自己，内核只提供这份代码。
	for (const effect of effects) {
		if (effect.kind !== graphMutateEffect.kind) continue;
		const outcome = await performGraphMutate(store, registry, id, effect.effectId);
		if (outcome !== "skipped") settled++;
	}

	// 其余并发执行：效果之间没有顺序保证（ADR-0002）。回执逐条落盘，避免自相冲突。
	// 缺 Performer 在执行前就抛，已经做过的结果作废、记录留在快照里——对图仍是 exactly-once。
	const external = effects.filter((effect) => effect.kind !== graphMutateEffect.kind);
	const results = await Promise.all(
		external.map(async (effect) => {
			const performer = performers[effect.kind];
			if (performer === undefined) throw new MissingPerformer(effect.kind);
			try {
				return { effect, result: await performer(effect.input, { workflowId: id, effect }) };
			} catch (error) {
				return { effect, result: failure(error) };
			}
		}),
	);

	for (const { effect, result } of results) {
		// 记录可能已经不在（origin 被同一批改图回收、或别处已经落过）：结果丢弃。
		if (await completeEffect(store, id, effect.effectId, result)) settled++;
	}
	return settled;
}

/**
 * 把快照里现有的在飞效果交出去（ADR-0003 的恢复扫描，或停住 `resume` 之后）：
 * 停住期间什么都不做——效果原地留着，等解除后再交出去（ADR-0008）。
 * 没有 `run`，只做“做效果 + 落回执”这一步；推进留给下一次 `run`。
 */
export async function performInFlight(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	performers: Performers,
): Promise<{ settled: number }> {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new WorkflowNotFound(id);
	if (loaded.snapshot.halted !== undefined) return { settled: 0 };
	if (loaded.snapshot.inFlight.length === 0) return { settled: 0 };
	return { settled: await settleRound(store, registry, id, performers, loaded.snapshot.inFlight) };
}

/** 宿主侧的护栏：轮数上限。内核不区分“静止”与“死锁”（ADR-0003），跑不动的图得有人喊停。 */
export const DEFAULT_MAX_ROUNDS = 1000;

export type DriveOptions = {
	performers: Performers;
	/** 透传给每一次 `run`：预算、转移日志、时钟、`effectId` 生成器。 */
	run?: RunOptions;
	maxRounds?: number;
};

export type DriveResult = {
	/**
	 * - `quiescent`：邮箱空、没有在飞效果
	 * - `halted`：停住，效果留在快照里等人处理
	 * - `rounds`：撞上宿主的轮数上限（不是停住）
	 */
	status: "quiescent" | "halted" | "rounds";
	/** 推了几轮：每次 `run` 算一轮（含最后那次收尾的）。 */
	rounds: number;
	/** 累计的转移步数（跨轮相加）。 */
	steps: number;
	/** 累计落了回执的效果条数。 */
	settled: number;
	/** 结束时的在飞效果数：停住时不为 0，等 `resume` 之后由恢复扫描交出去。 */
	inFlight: number;
};

/** 只读一次，用来报告停住时留在快照里的效果。 */
async function countInFlight(store: SnapshotStore, id: string): Promise<number> {
	const loaded = await store.load(id);
	if (loaded === undefined) throw new WorkflowNotFound(id);
	return loaded.snapshot.inFlight.length;
}

/**
 * 把一份工作流推到底：`run` → 交出它这次产生的效果 → `run` → …… 直到静止。
 * 每一轮之间都会重新落盘，所以中途崩溃留下的残局就是“有在飞效果”，下一次从这里接着走。
 *
 * 停住时立刻停手：不再交出新效果，也不碰留在快照里的那些（ADR-0008）。
 * 预算用完（`budget`）不是停住，直接进入下一轮（ADR-0007）。
 */
export async function driveWorkflow(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	options: DriveOptions,
): Promise<DriveResult> {
	const { performers } = options;
	const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
	let rounds = 0;
	let steps = 0;
	let settled = 0;

	// 上次留下的在飞效果（崩溃、或停住之后 resume）先交出去，再开始推进。
	settled += (await performInFlight(store, registry, id, performers)).settled;

	const finish = async (status: DriveResult["status"]): Promise<DriveResult> => ({
		status,
		rounds,
		steps,
		settled,
		inFlight: status === "quiescent" ? 0 : await countInFlight(store, id),
	});

	for (;;) {
		const outcome = await run(store, registry, id, options.run);
		rounds++;
		steps += outcome.steps;

		// 停住：这一轮已经提交的转移照留，效果一条都不交出去。
		if (outcome.status === "halted") return finish("halted");

		const produced = outcome.effects.length;
		if (produced > 0) settled += await settleRound(store, registry, id, performers, outcome.effects);

		// 邮箱空、这一轮也没出图：到底了。
		if (produced === 0 && outcome.status === "quiescent") return finish("quiescent");

		// budget（邮箱里还有消息，ADR-0007）或这一轮的效果还要接着推：下一轮。
		// 撞上宿主的上限就把快照留在当前状态交回调用方。
		if (rounds >= maxRounds) return finish("rounds");
	}
}
