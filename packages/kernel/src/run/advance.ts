import { z } from "zod";
import { checkEffects, effectRequestSchema, type InFlightEffect } from "../effect/index.ts";
import type { HaltReason } from "../halt.ts";
import { formatIssues } from "../issues.ts";
import { isReservedType, jsonSchema } from "../message.ts";
import type { Registry } from "../registry.ts";
import type { LogEntry } from "../transitionLog.ts";
import type { Snapshot } from "../workflow/snapshot.ts";
import { prepareSnapshot } from "./load.ts";

export type AdvanceOptions = {
	/** 本次 Run 最多处理多少条转移（ADR-0007）。 */
	budget: number;
	/** 单条快照的字节上限；超了就停住（ADR-0002、0008）。 */
	maxSnapshotBytes: number;
	now: () => Date;
	/** 给在飞的效果分配 `effectId`（内核的幂等键）。 */
	newEffectId: () => string;
};

export type AdvanceOutcome = {
	/** 推进后的快照；`changed` 为 false 时与入参相同。 */
	snapshot: Snapshot;
	/**
	 * - `quiescent`：所有邮箱为空
	 * - `budget`：预算用完，邮箱里还有消息；不是停住，可以再跑一次接着推（ADR-0007）
	 * - `halted`：停住，快照原样保留并带上原因（ADR-0008）
	 */
	status: "quiescent" | "budget" | "halted";
	steps: number;
	/** 本次新交出的效果：已记进 `snapshot.inFlight`，落盘之后才可以交给执行器（ADR-0003）。 */
	effects: InFlightEffect[];
	log: LogEntry[];
	changed: boolean;
};

const sendsSchema = z.array(
	z.object({ port: z.string().min(1), body: jsonSchema, to: z.string().min(1).optional() }),
);
const effectsSchema = z.array(effectRequestSchema);

type TransitionResult = { effects: InFlightEffect[]; log: LogEntry[] } | { halt: HaltReason };

/** 邮箱队首里入队序号最小的那个节点：全局 FIFO（ADR-0007）。 */
function nextNode(snapshot: Snapshot): string | undefined {
	let best: { id: string; seq: number } | undefined;
	for (const [id, node] of Object.entries(snapshot.graph.nodeStates)) {
		const head = node.mailbox[0];
		if (head !== undefined && (best === undefined || head.seq < best.seq)) best = { id, seq: head.seq };
	}
	return best?.id;
}

/**
 * Run 的核心（ADR-0003、0004、0005、0007、0008）：纯函数，快照进、快照出，不碰存储。
 *
 * 先做载入检查（迁移、版本、schema），再反复取全局最早的那条消息、让它的目标节点做一次转移：
 * 每次转移都在副本上先全量校验、再提交；不合规整条不提交、消息仍在队首，工作流停住。
 * 预算用完在当前转移之后停下，不算停住。
 */
export function advance(registry: Registry, input: Snapshot, options: AdvanceOptions): AdvanceOutcome {
	if (input.halted !== undefined) {
		return { snapshot: input, status: "halted", steps: 0, effects: [], log: [], changed: false };
	}

	const log: LogEntry[] = [];
	let current = structuredClone(input);
	let changed = false;

	const halted = (reason: HaltReason, steps: number, effects: InFlightEffect[]): AdvanceOutcome => {
		log.push({
			type: "halted",
			code: reason.code,
			...(reason.node === undefined ? {} : { node: reason.node }),
			detail: reason.detail,
			at: reason.at,
		});
		// 停住时快照原样保留：失败的转移、迁移都不留痕迹，只多一份原因。
		// 之前已提交的转移（及其在飞的效果）照常保留。
		return { snapshot: { ...current, halted: reason }, status: "halted", steps, effects, log, changed: true };
	};

	const prepared = structuredClone(current);
	const loadHalt = prepareSnapshot(registry, prepared, options.now, log);
	if (loadHalt !== undefined) {
		log.length = 0;
		return halted(loadHalt, 0, []);
	}
	if (log.length > 0) {
		current = prepared;
		changed = true;
	}

	const effects: InFlightEffect[] = [];
	let steps = 0;
	while (steps < options.budget) {
		const nodeId = nextNode(current);
		if (nodeId === undefined) break;

		const draft = structuredClone(current);
		const result = transition(registry, draft, nodeId, options);
		if ("halt" in result) {
			return halted(result.halt, steps, effects);
		}
		if (new TextEncoder().encode(JSON.stringify(draft)).length > options.maxSnapshotBytes) {
			return halted(
				{
					code: "snapshot_too_large",
					node: nodeId,
					detail: `snapshot exceeds ${options.maxSnapshotBytes} bytes`,
					at: options.now().toISOString(),
				},
				steps,
				effects,
			);
		}
		current = draft;
		steps++;
		changed = true;
		effects.push(...result.effects);
		log.push(...result.log);
	}

	return {
		snapshot: current,
		status: nextNode(current) === undefined ? "quiescent" : "budget",
		steps,
		effects,
		log,
		changed,
	};
}

/**
 * 在 `draft`（调用方的副本）上处理 `nodeId` 邮箱队首那条消息。
 * 先把 step 的产物全部校验完，再提交；返回 `halt` 时 `draft` 不再有意义。
 */
function transition(
	registry: Registry,
	draft: Snapshot,
	nodeId: string,
	options: AdvanceOptions,
): TransitionResult {
	const halt = (code: HaltReason["code"], detail: string): { halt: HaltReason } => ({
		halt: { code, node: nodeId, detail, at: options.now().toISOString() },
	});

	const { shape, nodeStates } = draft.graph;
	const record = shape.nodes[nodeId];
	const nodeState = nodeStates[nodeId];
	const head = nodeState?.mailbox[0];
	const definition = record && registry.node(record.definition);
	if (!record || !nodeState || !head || !definition) {
		return halt("graph_invalid", "node missing at transition time"); // 载入检查之后不该发生
	}

	let output: unknown;
	try {
		output = definition.step({ self: nodeId, config: record.config, state: nodeState.state, message: head.message });
	} catch (error) {
		return halt("step_threw", error instanceof Error ? error.message : String(error));
	}
	if (typeof output !== "object" || output === null || !("state" in output)) {
		return halt("step_threw", "step did not return a transition");
	}
	const out = output as { state: unknown; sends?: unknown; effects?: unknown };

	const state = definition.state.safeParse(out.state);
	if (!state.success) return halt("state_invalid", formatIssues(state.error));

	const sends = sendsSchema.safeParse(out.sends ?? []);
	if (!sends.success) return halt("send_invalid", formatIssues(sends.error));
	const requests = effectsSchema.safeParse(out.effects ?? []);
	if (!requests.success) return halt("effect_invalid", formatIssues(requests.error));

	const violation = checkEffects(registry, requests.data)[0];
	if (violation !== undefined) return halt("effect_invalid", JSON.stringify(violation));

	const ports = sends.data.length > 0 ? definition.ports(record.config) : {};
	const bodies: unknown[] = [];
	for (const send of sends.data) {
		if (isReservedType(send.port)) return halt("reserved_port", `port ${JSON.stringify(send.port)}`);
		const schema = ports[send.port];
		if (schema === undefined) return halt("send_invalid", `undeclared port ${JSON.stringify(send.port)}`);
		const body = schema.safeParse(send.body);
		if (!body.success) return halt("send_invalid", `port ${JSON.stringify(send.port)}: ${formatIssues(body.error)}`);
		bodies.push(body.data);
	}

	// —— 全部合规，提交 ——
	nodeState.mailbox.shift();
	nodeState.state = state.data as typeof nodeState.state;
	const log: LogEntry[] = [];
	const at = () => options.now().toISOString();

	// 沿边发是**订阅**（ADR-0011）：接了几个目标就投几份；显式 `to` 是**寻址**，只有一个目标。
	// 投递序按目标 id 升序，使 `seq` 只由快照决定，与边的书写顺序无关（ADR-0012）。
	let delivered = 0;
	sends.data.forEach((send, i) => {
		const targets =
			send.to !== undefined
				? [send.to]
				: shape.edges
						.filter((edge) => edge.from === nodeId && edge.port === send.port)
						.map((edge) => edge.to)
						.sort();
		if (targets.length === 0) {
			log.push({ type: "dropped", from: nodeId, port: send.port, reason: "no_edge", at: at() });
			return;
		}
		for (const target of targets) {
			const targetState = nodeStates[target];
			if (targetState === undefined) {
				log.push({ type: "dropped", from: nodeId, port: send.port, reason: "no_target", at: at() });
				continue;
			}
			targetState.mailbox.push({
				seq: draft.nextSeq++,
				message: { from: nodeId, type: send.port, body: bodies[i] as never },
			});
			delivered++;
		}
	});

	const effects: InFlightEffect[] = requests.data.map((request) => ({
		effectId: options.newEffectId(),
		origin: nodeId,
		kind: request.kind,
		input: request.input,
		...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
	}));
	draft.inFlight.push(...effects);

	log.unshift({
		type: "transition",
		node: nodeId,
		messageType: head.message.type,
		seq: head.seq,
		sends: sends.data.length,
		delivered,
		effects: effects.length,
		at: at(),
	});
	return { effects, log };
}
