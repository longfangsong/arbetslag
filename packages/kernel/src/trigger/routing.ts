import { type MatchEvent, type MatchSpec, evaluateMatch } from "./matcher.ts";
import type { Registry } from "../registry.ts";

/** 路由索引里的一行：哪份工作流的哪条触发器，以及它的匹配、分组、优先级（ADR-0015）。 */
export type Subscription = {
	workflowId: string;
	trigger: string;
	match?: MatchSpec;
	group: string;
	priority: number;
};

export type MatchFailure = { subscription: Subscription; error: unknown };

export type Selection = {
	/** 要投的订阅：按 `(workflowId, trigger)` 排序，与索引里的行序无关。 */
	targets: Subscription[];
	/** 匹配函数抛错或未注册的订阅：按不匹配处理，交给调用方报告。 */
	failures: MatchFailure[];
};

const byTarget = (a: Subscription, b: Subscription): number =>
	a.workflowId === b.workflowId ? (a.trigger < b.trigger ? -1 : 1) : a.workflowId < b.workflowId ? -1 : 1;

/**
 * 路由的选择（ADR-0015）：纯函数，宿主的路由调用它，Node 与 Workers 共用。
 *
 * 订阅按分组分开；每个分组内按优先级从高到低逐层执行匹配函数，遇到第一个有命中的层就停，
 * 这一层命中的全部收到。各分组互不影响，选出的目标合在一起。
 * 逐个跑，没有索引：每个事件 O(订阅数)。
 */
export function selectSubscribers(
	registry: Registry,
	subscriptions: readonly Subscription[],
	event: MatchEvent,
): Selection {
	const groups = new Map<string, Map<number, Subscription[]>>();
	for (const subscription of subscriptions) {
		const layers = groups.get(subscription.group) ?? new Map<number, Subscription[]>();
		layers.set(subscription.priority, [...(layers.get(subscription.priority) ?? []), subscription]);
		groups.set(subscription.group, layers);
	}

	const targets: Subscription[] = [];
	const failures: MatchFailure[] = [];
	for (const layers of groups.values()) {
		const priorities = [...layers.keys()].sort((a, b) => b - a);
		for (const priority of priorities) {
			const hits = (layers.get(priority) ?? []).filter((subscription) => {
				try {
					return evaluateMatch(registry, subscription.match, event);
				} catch (error) {
					failures.push({ subscription, error });
					return false;
				}
			});
			if (hits.length > 0) {
				targets.push(...hits);
				break;
			}
		}
	}
	return { targets: targets.sort(byTarget), failures };
}
