import type { HaltReason } from "../halt.ts";
import { formatIssues } from "../issues.ts";
import type { Registry } from "../registry.ts";
import type { LogEntry } from "../transitionLog.ts";
import { checkShapeAgainstRegistry } from "../workflow/shape/index.ts";
import { type Snapshot, checkSnapshot } from "../workflow/snapshot.ts";

/**
 * 载入时的检查（ADR-0004、0008）。在传入的快照上就地做：版本落后的节点迁移到当前版本，
 * 其余只校验。失败返回停住原因，此时调用方应当丢掉这份被动过的快照、用原样的加上原因。
 *
 * - 快照自身的结构不变量被破坏 → `graph_invalid`
 * - 节点定义未知 → `definition_unknown`；记录版本比在场定义新 → `version_ahead`
 * - config 不合规 → `config_invalid`
 * - 版本落后：有 `migrate` 就调用它，没有就沿用旧 state；结果必须符合 state schema，
 *   否则 `migration_failed`（调用了 migrate）或 `state_invalid`（没有）
 * - 形状对照注册表：从触发器出发的边 → `trigger_invalid`，其余 → `graph_invalid`
 */
export function prepareSnapshot(
	registry: Registry,
	snapshot: Snapshot,
	now: () => Date,
	log: LogEntry[],
): HaltReason | undefined {
	const halt = (code: HaltReason["code"], detail: string, node?: string): HaltReason => ({
		code,
		...(node === undefined ? {} : { node }),
		detail,
		at: now().toISOString(),
	});

	const structural = checkSnapshot(snapshot);
	if (structural.length > 0) {
		return halt("graph_invalid", JSON.stringify(structural[0]));
	}

	const { shape, nodeStates } = snapshot.graph;
	for (const [id, record] of Object.entries(shape.nodes)) {
		const definition = registry.node(record.definition);
		if (definition === undefined) {
			return halt("definition_unknown", `no node definition named ${JSON.stringify(record.definition)}`, id);
		}
		const nodeState = nodeStates[id];
		if (nodeState === undefined) continue; // 结构检查已经保证有
		if (nodeState.version > definition.version) {
			return halt("version_ahead", `state is version ${nodeState.version}, definition is ${definition.version}`, id);
		}
		const config = definition.config.safeParse(record.config);
		if (!config.success) return halt("config_invalid", formatIssues(config.error), id);

		let migrated = false;
		if (nodeState.version < definition.version) {
			if (definition.migrate !== undefined) {
				try {
					nodeState.state = definition.migrate(nodeState.state, nodeState.version);
					migrated = true;
				} catch (error) {
					return halt("migration_failed", error instanceof Error ? error.message : String(error), id);
				}
			}
			log.push({ type: "migrated", node: id, from: nodeState.version, to: definition.version, at: now().toISOString() });
			nodeState.version = definition.version;
		}
		const state = definition.state.safeParse(nodeState.state);
		if (!state.success) {
			return halt(migrated ? "migration_failed" : "state_invalid", formatIssues(state.error), id);
		}
		if (migrated) nodeState.state = state.data;
	}

	const triggerIds = new Set(shape.triggers.map((t) => t.id));
	for (const violation of checkShapeAgainstRegistry(registry, shape)) {
		const detail = JSON.stringify(violation);
		switch (violation.code) {
			case "trigger_kind_unknown":
			case "trigger_config_invalid":
				return halt("trigger_invalid", detail, violation.id);
			case "edge_port_undeclared":
				return halt(triggerIds.has(violation.edge.from) ? "trigger_invalid" : "graph_invalid", detail, violation.edge.from);
			default:
				// 节点定义/config 的违规上面已经逐个报过
				return halt("graph_invalid", detail);
		}
	}
	return undefined;
}
