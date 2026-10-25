import type { AnyNodeDefinition } from "./nodeDefinition.ts";
import type { EffectKindDefinition } from "./effect/index.ts";
import { graphMutateEffect } from "./workflow/graph/mutation.ts";
import type { TriggerKindDefinition } from "./triggerKind.ts";

/**
 * 注入给内核的注册表（ADR-0001、0004、0006）：节点定义、效果种类、触发器种类。
 * 每个名字只有一份——当前部署的那一版。内核只读它，从不改它。
 * 框架提供的效果种类（`graph.mutate`）自带，宿主不用也不能再注册。
 */
export type Registry = {
	node(name: string): AnyNodeDefinition | undefined;
	effectKind(kind: string): EffectKindDefinition | undefined;
	triggerKind(kind: string): TriggerKindDefinition | undefined;
};

export type RegistryInput = {
	nodes?: AnyNodeDefinition[];
	effects?: EffectKindDefinition[];
	triggers?: TriggerKindDefinition[];
};

function index<T>(items: T[] | undefined, key: (item: T) => string, what: string): Map<string, T> {
	const map = new Map<string, T>();
	for (const item of items ?? []) {
		const name = key(item);
		if (name === "" || name.startsWith("@")) {
			throw new Error(`invalid ${what} name: ${JSON.stringify(name)}`);
		}
		if (map.has(name)) throw new Error(`duplicate ${what}: ${name}`);
		map.set(name, item);
	}
	return map;
}

/** 注册错误是部署时的编程错误，直接抛，不进停住。 */
export function createRegistry(input: RegistryInput): Registry {
	const nodes = index(input.nodes, (d) => d.name, "node definition");
	const effects = index([graphMutateEffect, ...(input.effects ?? [])], (d) => d.kind, "effect kind");
	const triggers = index(input.triggers, (d) => d.kind, "trigger kind");
	return {
		node: (name) => nodes.get(name),
		effectKind: (kind) => effects.get(kind),
		triggerKind: (kind) => triggers.get(kind),
	};
}
