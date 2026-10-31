import { formatIssues } from "../../issues.ts";
import type { Registry } from "../../registry.ts";
import type { Snapshot } from "../snapshot.ts";
import type { SnapshotStore } from "../../snapshotStore.ts";
import {
	checkShapeAgainstRegistry,
	checkWorkflowShape,
	type RegistryViolation,
	type WorkflowShape,
	type WorkflowShapeViolation,
} from "../shape/index.ts";
import { initialNodeState } from "../graph/nodeState.ts";
import { workflowTemplateSchema, type WorkflowTemplate } from "./template.ts";

export type InstantiateViolation =
	| { code: "template_malformed"; detail: string }
	| WorkflowShapeViolation
	| RegistryViolation
	| { code: "node_state_invalid"; id: string; detail: string };

/**
 * 写错模板在落盘之前就被拒（ADR-0004）：这时还没有工作流，所以不是停住，
 * 而是抛这个错，带全部违规。
 */
export class InstantiateError extends Error {
	readonly violations: InstantiateViolation[];

	constructor(violations: InstantiateViolation[]) {
		super(`invalid template: ${violations.map((v) => v.code).join(", ")}`);
		this.name = "InstantiateError";
		this.violations = violations;
	}
}

/**
 * 用一份模板造出一份快照（不落盘）。config 与 state 取 schema 解析后的输出，
 * 所以默认值在这一刻写进快照。邮箱为空，没有在飞的效果。
 */
export function instantiate(registry: Registry, template: WorkflowTemplate): Snapshot {
	const parsed = workflowTemplateSchema.safeParse(template);
	if (!parsed.success) {
		throw new InstantiateError([{ code: "template_malformed", detail: formatIssues(parsed.error) }]);
	}
	const { nodes, edges, triggers } = parsed.data;

	const shape: WorkflowShape = {
		nodes: Object.fromEntries(
			Object.entries(nodes).map(([id, node]) => [id, { definition: node.definition, config: node.config }]),
		),
		edges,
		triggers,
	};

	const violations: InstantiateViolation[] = [
		...checkWorkflowShape(shape),
		...checkShapeAgainstRegistry(registry, shape),
	];

	const nodeStates: Snapshot["graph"]["nodeStates"] = {};
	for (const [id, node] of Object.entries(nodes)) {
		const definition = registry.node(node.definition);
		if (definition === undefined) continue; // 已经报过
		const initial = initialNodeState(definition, node.state);
		if (!initial.ok) {
			violations.push({ code: "node_state_invalid", id, detail: initial.detail });
			continue;
		}
		nodeStates[id] = initial.nodeState;
	}

	if (violations.length > 0) throw new InstantiateError(violations);

	// 全部合规：把 config 换成解析后的输出，默认值落进快照。
	for (const node of Object.values(shape.nodes)) {
		const definition = registry.node(node.definition);
		if (definition) node.config = definition.config.parse(node.config);
	}
	for (const trigger of shape.triggers) {
		const kind = registry.triggerKind(trigger.kind);
		if (kind) trigger.config = kind.config.parse(trigger.config);
	}

	return { graph: { shape, nodeStates }, inFlight: [], nextSeq: 0 };
}

export type CreateWorkflowOptions = {
	/** 不给就由框架生成。id 是不透明字符串，等于 store key（ADR-0003）。 */
	id?: string;
};

/**
 * 实例化并落盘：用模板造出一份工作流，并给它一个 id。
 * id 已存在抛 `WorkflowExists`——不提供"已存在就复用"，幂等由调用方 `load` 后自己表达。
 */
export async function createWorkflow(
	store: SnapshotStore,
	registry: Registry,
	template: WorkflowTemplate,
	options: CreateWorkflowOptions = {},
): Promise<{ id: string }> {
	const id = options.id ?? crypto.randomUUID();
	await store.create(id, instantiate(registry, template));
	return { id };
}
