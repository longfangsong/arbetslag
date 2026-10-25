import type { JsonValue } from "type-fest";
import { z } from "zod";
import { formatIssues } from "../../issues.ts";
import { jsonSchema } from "../../message.ts";
import type { AnyNodeDefinition } from "../../nodeDefinition.ts";
import { mailboxEntrySchema } from "./mailbox.ts";

/**
 * 一个节点的运行时那一半：私有状态与邮箱（ADR-0002、0004）。
 * 节点记录（是哪份定义、什么 config）在形状里。
 */
export const nodeStateSchema = z.object({
	/** 这份 state 由哪一版节点定义写下；内核只比较它（ADR-0004）。 */
	version: z.number().int().nonnegative(),
	state: jsonSchema,
	/** 按到达顺序；`seq` 严格递增。 */
	mailbox: z.array(mailboxEntrySchema),
});

export type NodeState = z.infer<typeof nodeStateSchema>;

/**
 * 一个新节点的初始运行时状态：给了 state 就用它（也要过 schema），
 * 没给就让定义的 `state` schema 解析 `undefined`（带默认值的 schema）。
 * 取解析后的输出，所以默认值在这一刻写进快照。
 */
export function initialNodeState(
	definition: AnyNodeDefinition,
	given: JsonValue | undefined,
): { ok: true; nodeState: NodeState } | { ok: false; detail: string } {
	const parsed = definition.state.safeParse(given);
	if (!parsed.success) return { ok: false, detail: formatIssues(parsed.error) };
	return { ok: true, nodeState: { version: definition.version, state: parsed.data, mailbox: [] } };
}
