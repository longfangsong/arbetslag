import type { JsonValue } from "type-fest";
import type { InFlightEffect } from "@arbetslag/kernel";

/**
 * 一种**效果种类**在宿主里的实现（`CONTEXT.md` 的「宿主」）：宿主按平台各写一份，
 * 内核不认识它、只认注册表里的 schema。拿 `input`，把外部世界的结果作为 `result` 交回——
 * 成功与失败都是结果（ADR-0006）。
 */
export type PerformContext = {
	workflowId: string;
	/** 整条在飞记录：`effectId` 是对外的幂等键，`correlationId` 是作者给的配对键。 */
	effect: InFlightEffect;
	/** 超时（或宿主停下）时 abort；Performer 应当把它传给自己的外部调用。 */
	signal: AbortSignal;
};

export type Performer = (input: JsonValue, context: PerformContext) => JsonValue | Promise<JsonValue>;

/** 按效果种类查对应的 **Performer**；缺的那一种就是当前部署没实现它。 */
export type Performers = Readonly<Record<string, Performer | undefined>>;

/**
 * 部署错误：快照里有在飞效果，但这个部署没有它的 **Performer**。
 * 不是停住（ADR-0008）——记录原样留在快照里，补上 Performer 的部署（新的激活）会再交出它。
 */
export class MissingPerformer extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`no performer for effect kind ${JSON.stringify(kind)}`);
		this.name = "MissingPerformer";
		this.kind = kind;
	}
}

/** Performer 超过宿主给的时限（ADR-0014）：当作失败结果落回执，激活内不再重交。 */
export class PerformerTimeout extends Error {
	readonly kind: string;
	readonly ms: number;

	constructor(kind: string, ms: number) {
		super(`effect ${JSON.stringify(kind)} timed out after ${ms}ms`);
		this.name = "PerformerTimeout";
		this.kind = kind;
		this.ms = ms;
	}
}

/**
 * Performer 抛错或超时回给节点的结果（宿主约定）：失败是正常结果，不是内核故障。
 * 效果种类的 `result` schema 应当接受它；不接受就在 Performer 里把错误转成自己的形状再返回。
 */
export function failure(error: unknown): JsonValue {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

/**
 * 默认时限：10 分钟。必须小于 Durable Object 单个出站操作的 15 分钟上限（ADR-0014），
 * 两个宿主用同一个数，行为才一致。
 */
export const DEFAULT_PERFORMER_TIMEOUT_MS = 10 * 60 * 1000;

/** 跑一次 Performer，带时限：抛错与超时都变成失败结果，从不 reject。 */
export async function perform(
	performer: Performer,
	context: Omit<PerformContext, "signal">,
	timeoutMs: number,
): Promise<JsonValue> {
	const controller = new AbortController();
	const timedOut = new Promise<never>((_resolve, reject) => {
		controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
	});
	const timer = setTimeout(() => controller.abort(new PerformerTimeout(context.effect.kind, timeoutMs)), timeoutMs);
	try {
		const work = Promise.resolve().then(() =>
			performer(context.effect.input, { ...context, signal: controller.signal }),
		);
		// 输掉比赛的那一方之后才 settle，不再有人等：吞掉它的拒绝。
		work.catch(() => {});
		timedOut.catch(() => {});
		return await Promise.race([work, timedOut]);
	} catch (error) {
		return failure(error);
	} finally {
		clearTimeout(timer);
	}
}
