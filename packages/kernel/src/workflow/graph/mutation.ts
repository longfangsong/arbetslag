import type { JsonValue } from "type-fest";
import { z } from "zod";
import type { EffectKindDefinition } from "../../effect/index.ts";
import { jsonSchema } from "../../message.ts";
import type { Registry } from "../../registry.ts";
import {
	checkShapeAgainstRegistry,
	checkWorkflowShape,
	type Edge,
	type RegistryViolation,
	type WorkflowShapeViolation,
} from "../shape/index.ts";
import type { Snapshot } from "../snapshot.ts";
import { type WorkflowGraphViolation, checkWorkflowGraph } from "./check.ts";
import { initialNodeState } from "./nodeState.ts";
import { type GraphOp, graphOpSchema } from "./ops.ts";

export type GraphMutationViolation =
	| WorkflowShapeViolation
	| RegistryViolation
	| WorkflowGraphViolation
	| { code: "spawn_id_taken"; id: string }
	| { code: "spawn_state_invalid"; id: string; detail: string }
	| { code: "retire_unknown"; id: string }
	| { code: "disconnect_unknown"; edge: Edge }
	| { code: "remove_trigger_unknown"; id: string };

export type GraphMutationResult =
	| { ok: true; snapshot: Snapshot }
	| { ok: false; violations: GraphMutationViolation[] };

const sameEdge = (a: Edge, b: Edge) => a.from === b.from && a.to === b.to && a.port === b.port;

/**
 * 对一份快照应用一批改图操作（ADR-0002、0006）：纯函数，不改入参。
 * 先在副本上按固定顺序应用，再全量校验（形状不变量 + 对照注册表）；
 * 任何违规都整批不生效。回收节点时，以它为 origin 的在飞记录一并丢弃。
 */
export function applyGraphMutation(
	registry: Registry,
	snapshot: Snapshot,
	ops: GraphOp[],
): GraphMutationResult {
	const next = structuredClone(snapshot);
	const { shape, nodeStates } = next.graph;
	const violations: GraphMutationViolation[] = [];
	const spawned = new Set<string>();
	const addedTriggers = new Set<string>();

	// 1. 新增
	for (const op of ops) {
		if (op.op === "spawn") {
			if (Object.hasOwn(shape.nodes, op.id)) {
				violations.push({ code: "spawn_id_taken", id: op.id });
				continue;
			}
			shape.nodes[op.id] = { definition: op.definition, config: op.config };
			spawned.add(op.id);
			const definition = registry.node(op.definition);
			if (definition === undefined) continue; // 下面对照注册表时会报
			const initial = initialNodeState(definition, op.state);
			if (initial.ok) nodeStates[op.id] = initial.nodeState;
			else violations.push({ code: "spawn_state_invalid", id: op.id, detail: initial.detail });
		} else if (op.op === "addTrigger") {
			shape.triggers.push({ id: op.id, kind: op.kind, config: op.config });
			addedTriggers.add(op.id);
		}
	}

	// 2. 断线
	for (const op of ops) {
		if (op.op !== "disconnect") continue;
		const edge: Edge = { from: op.from, to: op.to, port: op.port };
		const at = shape.edges.findIndex((e) => sameEdge(e, edge));
		if (at < 0) violations.push({ code: "disconnect_unknown", edge });
		else shape.edges.splice(at, 1);
	}

	// 3. 接线
	for (const op of ops) {
		if (op.op !== "connect") continue;
		shape.edges.push({ from: op.from, to: op.to, port: op.port });
	}

	// 4. 回收
	const retired = new Set<string>();
	for (const op of ops) {
		if (op.op === "retire") {
			if (!Object.hasOwn(shape.nodes, op.id)) {
				violations.push({ code: "retire_unknown", id: op.id });
				continue;
			}
			delete shape.nodes[op.id];
			delete nodeStates[op.id];
			retired.add(op.id);
		} else if (op.op === "removeTrigger") {
			const at = shape.triggers.findIndex((t) => t.id === op.id);
			if (at < 0) {
				violations.push({ code: "remove_trigger_unknown", id: op.id });
				continue;
			}
			shape.triggers.splice(at, 1);
			shape.edges = shape.edges.filter((e) => e.from !== op.id);
		}
	}
	if (retired.size > 0) {
		shape.edges = shape.edges.filter((e) => !retired.has(e.from) && !retired.has(e.to));
		next.inFlight = next.inFlight.filter((effect) => !retired.has(effect.origin));
	}

	violations.push(...checkWorkflowShape(shape), ...checkShapeAgainstRegistry(registry, shape));
	if (violations.length === 0) violations.push(...checkWorkflowGraph(next.graph));
	if (violations.length > 0) return { ok: false, violations };

	// 全部合规：新节点与新触发器的 config 取解析后的输出，默认值落进快照（同实例化）。
	for (const id of spawned) {
		const node = shape.nodes[id];
		const definition = node && registry.node(node.definition);
		if (node && definition) node.config = definition.config.parse(node.config);
	}
	for (const trigger of shape.triggers) {
		if (!addedTriggers.has(trigger.id)) continue;
		const kind = registry.triggerKind(trigger.kind);
		if (kind) trigger.config = kind.config.parse(trigger.config);
	}
	return { ok: true, snapshot: next };
}

/**
 * 框架提供的效果种类 `graph.mutate`（ADR-0006）：`input` 是一批操作，
 * `result` 是成功，或失败加违规列表。注册表自带它，宿主不用也不能再注册同名种类。
 */
export const graphMutateEffect: EffectKindDefinition = {
	kind: "graph.mutate",
	input: z.object({ ops: z.array(graphOpSchema) }),
	result: z.union([
		z.object({ ok: z.literal(true) }),
		z.object({ ok: z.literal(false), violations: z.array(jsonSchema) }),
	]),
};

/** 把改图的结果变成回执里的 `result`。违规是纯数据，原样 JSON 化。 */
export function graphMutationResult(result: GraphMutationResult): JsonValue {
	if (result.ok) return { ok: true };
	return { ok: false, violations: JSON.parse(JSON.stringify(result.violations)) };
}
