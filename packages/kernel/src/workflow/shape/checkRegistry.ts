import { formatIssues } from "../../issues.ts";
import type { Registry } from "../../registry.ts";
import type { Edge } from "./edge.ts";
import type { WorkflowShape } from "./shape.ts";

export type RegistryViolation =
	| { code: "node_definition_unknown"; id: string; definition: string }
	| { code: "node_config_invalid"; id: string; detail: string }
	| { code: "edge_port_undeclared"; edge: Edge }
	| { code: "trigger_kind_unknown"; id: string; kind: string }
	| { code: "trigger_config_invalid"; id: string; detail: string };

/**
 * 形状对照注册表（ADR-0001、0002、0004）：
 * - 节点的定义必须在注册表里，config 必须符合定义的 schema
 * - 触发器的 kind 必须已注册，config 必须符合它的 schema
 * - 边的端口必须是起点声明过的：节点看 `ports(config)`，触发器看 `outputs(config)`
 *
 * 起点本身有问题（定义未知、config 不合规）时不再重复报它的接线。
 */
export function checkShapeAgainstRegistry(
	registry: Registry,
	shape: WorkflowShape,
): RegistryViolation[] {
	const violations: RegistryViolation[] = [];
	const declared = new Map<string, Set<string>>();

	for (const [id, node] of Object.entries(shape.nodes)) {
		const definition = registry.node(node.definition);
		if (definition === undefined) {
			violations.push({ code: "node_definition_unknown", id, definition: node.definition });
			continue;
		}
		const config = definition.config.safeParse(node.config);
		if (!config.success) {
			violations.push({ code: "node_config_invalid", id, detail: formatIssues(config.error) });
			continue;
		}
		declared.set(id, new Set(Object.keys(definition.ports(config.data))));
	}

	for (const trigger of shape.triggers) {
		const kind = registry.triggerKind(trigger.kind);
		if (kind === undefined) {
			violations.push({ code: "trigger_kind_unknown", id: trigger.id, kind: trigger.kind });
			continue;
		}
		const config = kind.config.safeParse(trigger.config);
		if (!config.success) {
			violations.push({ code: "trigger_config_invalid", id: trigger.id, detail: formatIssues(config.error) });
			continue;
		}
		declared.set(trigger.id, new Set(Object.keys(kind.outputs(config.data))));
	}

	for (const edge of shape.edges) {
		const ports = declared.get(edge.from);
		if (ports !== undefined && !ports.has(edge.port)) {
			violations.push({ code: "edge_port_undeclared", edge });
		}
	}
	return violations;
}
