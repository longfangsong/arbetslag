import type { JsonValue } from "type-fest";
import { InvalidDelivery, WorkflowHalted } from "../errors.ts";
import { isReservedType } from "../message.ts";
import type { Registry } from "../registry.ts";
import type { SnapshotStore } from "../snapshotStore.ts";
import { type TransitionLog, appendLog } from "../transitionLog.ts";
import type { Snapshot } from "../workflow/snapshot.ts";
import { update } from "./update.ts";

export type DeliverOptions = { log?: TransitionLog; now?: () => Date };

/** 对目标节点邮箱做一次追加；调用方保证已经检查过目标。 */
function append(snapshot: Snapshot, node: string, type: string, body: JsonValue): void {
	const target = snapshot.graph.nodeStates[node];
	if (target === undefined) throw new InvalidDelivery(`no such node: ${JSON.stringify(node)}`);
	target.mailbox.push({ seq: snapshot.nextSeq++, message: { type, body } });
}

function checkOpen(id: string, snapshot: Snapshot): void {
	if (snapshot.halted !== undefined) throw new WorkflowHalted(id, snapshot.halted);
}

/**
 * 直接向某个节点投一条消息：邮箱上的一次 CAS 追加（ADR-0001、0003）。
 * 没有发件人，不经过边；投递之后要不要 `run` 是调用方的事。
 * at-least-once，内核不去重。已停住抛 `WorkflowHalted`；冲突重载重来 ≤3 次后抛 `Conflict`。
 */
export async function deliverToNode(
	store: SnapshotStore,
	id: string,
	node: string,
	message: { type: string; body: JsonValue },
): Promise<void> {
	if (message.type === "" || isReservedType(message.type)) {
		throw new InvalidDelivery(`invalid message type: ${JSON.stringify(message.type)}`);
	}
	await update(store, id, (snapshot) => {
		checkOpen(id, snapshot);
		append(snapshot, node, message.type, message.body);
		return { snapshot, value: undefined };
	});
}

/**
 * 触发器把外部事件投进工作流（ADR-0001）：`output` 是触发器种类声明的输出名，
 * body 按它的 schema 校验——不合规拒绝投递（`InvalidDelivery`），不停住；
 * 从 `(trigger, output)` 出发的边决定去哪个节点，没接线就丢弃并记一条日志，返回 `false`。
 */
export async function deliverFromTrigger(
	store: SnapshotStore,
	registry: Registry,
	id: string,
	trigger: string,
	output: string,
	body: JsonValue,
	options: DeliverOptions = {},
): Promise<boolean> {
	const delivered = await update(store, id, (snapshot) => {
		checkOpen(id, snapshot);
		const declaration = snapshot.graph.shape.triggers.find((t) => t.id === trigger);
		if (declaration === undefined) throw new InvalidDelivery(`no such trigger: ${JSON.stringify(trigger)}`);
		const kind = registry.triggerKind(declaration.kind);
		if (kind === undefined) throw new InvalidDelivery(`unknown trigger kind: ${JSON.stringify(declaration.kind)}`);
		const config = kind.config.safeParse(declaration.config);
		if (!config.success) throw new InvalidDelivery(`invalid trigger config: ${JSON.stringify(trigger)}`);
		const schema = kind.outputs(config.data)[output];
		if (schema === undefined) throw new InvalidDelivery(`undeclared output: ${JSON.stringify(output)}`);
		const parsed = schema.safeParse(body);
		if (!parsed.success) throw new InvalidDelivery(`body does not match output ${JSON.stringify(output)}`);

		const edge = snapshot.graph.shape.edges.find((e) => e.from === trigger && e.port === output);
		if (edge === undefined) return { value: false }; // 没人订阅：丢弃，不写
		append(snapshot, edge.to, output, parsed.data as JsonValue);
		return { snapshot, value: true };
	});
	if (!delivered) {
		const at = (options.now ?? (() => new Date()))().toISOString();
		await appendLog(options.log, id, [{ type: "dropped", from: trigger, port: output, reason: "no_edge", at }]);
	}
	return delivered;
}
