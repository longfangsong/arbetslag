import type { JsonValue } from "type-fest";
import { InvalidDelivery, WorkflowHalted } from "../failure/errors.ts";
import { isReservedType } from "../message.ts";
import type { Registry } from "../registry.ts";
import type { SnapshotStore } from "../store/snapshotStore.ts";
import { type TransitionLog, appendLog } from "../store/log.ts";
import type { Snapshot } from "../workflow/snapshot.ts";

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
 * 直接向某个节点投一条消息：邮箱上的一次追加，在存储的临界区里做（ADR-0001、0003、0013）。
 * 没有发件人，不经过边；投递之后要不要 `run` 是调用方的事。
 * at-least-once，内核不去重。已停住抛 `WorkflowHalted`。
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
	await store.commit(id, (snapshot) => {
		checkOpen(id, snapshot);
		append(snapshot, node, message.type, message.body);
		return { snapshot, value: undefined };
	});
}

/**
 * 触发器的一条事件进邮箱（ADR-0001、0015）：纯的，就地改传入的快照，给宿主在一次存储事务里调用
 * （路由发件箱的一批行 + 游标，同一次提交）。
 *
 * `output` 是触发器种类声明的输出名，body 按它的 schema 校验——不合规抛 `InvalidDelivery`，不停住；
 * 从 `(trigger, output)` 出发的边决定去哪些节点（边是订阅，可以有多个，ADR-0011）。
 * 没接线返回 `false`（丢弃，不改快照）。已停住抛 `WorkflowHalted`。
 */
export function applyTriggerDelivery(
	registry: Registry,
	id: string,
	snapshot: Snapshot,
	trigger: string,
	output: string,
	body: JsonValue,
): boolean {
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

	// 订阅者可以有多个；按目标 id 升序取 `seq`，与边的书写顺序无关（ADR-0012）。
	const targets = snapshot.graph.shape.edges
		.filter((e) => e.from === trigger && e.port === output)
		.map((e) => e.to)
		.sort();
	for (const target of targets) append(snapshot, target, output, parsed.data as JsonValue);
	return targets.length > 0;
}

/**
 * 单独投一条触发器事件（`applyTriggerDelivery` 加一次提交）：给测试与不经过路由的调用方用。
 * 没接线就丢弃并记一条日志，返回 `false`。
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
	const delivered = await store.commit(id, (snapshot) =>
		applyTriggerDelivery(registry, id, snapshot, trigger, output, body)
			? { snapshot, value: true }
			: { value: false },
	);
	if (!delivered) {
		const at = (options.now ?? (() => new Date()))().toISOString();
		await appendLog(options.log, id, [{ type: "dropped", from: trigger, port: output, reason: "no_edge", at }]);
	}
	return delivered;
}
