import { isReservedType } from "../../message.ts";
import type { Edge } from "./edge.ts";
import type { WorkflowShape } from "./shape.ts";

/** 形状自身的不变量被破坏的原因；调用方（改图、载入）把它们转成停住。 */
export type WorkflowShapeViolation =
	| { code: "edge_port_taken"; edge: Edge }
	| { code: "edge_dangling"; edge: Edge; missing: string }
	| { code: "edge_reserved_port"; edge: Edge }
	| { code: "id_collision"; id: string }
	| { code: "trigger_duplicate_id"; id: string };

/**
 * 检查与注册表无关的结构不变量：
 * - `(from, port)` 至多一条（端口单值；完全重复的边也在其中）
 * - 自环合法
 * - 边的 `from` 必须是活节点或触发器，`to` 必须是活节点（回收连带删边，不留悬空）
 * - 边的端口名不得占用 `@` 前缀
 * - 触发器 id 唯一，且不与节点 id 重名
 *
 * 端口是否被节点定义（或触发器种类）声明、kind 是否已注册，需要注册表，不在这里查。
 */
export function checkWorkflowShape(shape: WorkflowShape): WorkflowShapeViolation[] {
	const violations: WorkflowShapeViolation[] = [];
	const isNode = (id: string) => Object.hasOwn(shape.nodes, id);

	const triggerIds = new Set<string>();
	for (const trigger of shape.triggers) {
		if (triggerIds.has(trigger.id)) {
			violations.push({ code: "trigger_duplicate_id", id: trigger.id });
		} else if (isNode(trigger.id)) {
			violations.push({ code: "id_collision", id: trigger.id });
		}
		triggerIds.add(trigger.id);
	}

	const seenPort = new Set<string>();

	for (const edge of shape.edges) {
		const named = JSON.stringify([edge.from, edge.port]);
		if (seenPort.has(named)) violations.push({ code: "edge_port_taken", edge });
		seenPort.add(named);
		if (isReservedType(edge.port)) violations.push({ code: "edge_reserved_port", edge });

		if (!isNode(edge.from) && !triggerIds.has(edge.from)) {
			violations.push({ code: "edge_dangling", edge, missing: edge.from });
		}
		if (!isNode(edge.to)) {
			violations.push({ code: "edge_dangling", edge, missing: edge.to });
		}
	}

	return violations;
}
