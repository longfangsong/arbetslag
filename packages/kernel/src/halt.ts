import { z } from "zod";

/**
 * 停住的原因（ADR-0008）：封闭枚举，宿主按它写处理逻辑。
 * 停住是内核唯一的失败出口；效果失败、坏消息、预算耗尽、触发器起不来都不是。
 */
export const haltCodes = [
	/** step 抛错。 */
	"step_threw",
	/** 节点 state 不符合 schema（转移之后或载入时）。 */
	"state_invalid",
	/** 节点 config 不符合 schema。 */
	"config_invalid",
	/** 迁移失败（抛错，或输出不符合 state schema）。 */
	"migration_failed",
	/** 节点记录的定义名在注册表里没有。 */
	"definition_unknown",
	/** 记录版本比在场定义新（回滚部署）。 */
	"version_ahead",
	/** 改图非法：形状不变量被破坏、接线用了未声明的端口等。 */
	"graph_invalid",
	/** 触发器声明非法：未知 kind、config 不合规、接线的输出未声明。 */
	"trigger_invalid",
	/** 交出的效果种类未知，或 `input` 不合规。 */
	"effect_invalid",
	/** 节点发送用了 `@` 前缀的端口。 */
	"reserved_port",
	/** 节点发送用了未声明的端口，或 body 不符合端口的 schema。 */
	"send_invalid",
	/** 快照超出单条记录的上限。 */
	"snapshot_too_large",
] as const;

export type HaltCode = (typeof haltCodes)[number];

/** 快照里记的停住原因：结构化，不含堆栈。 */
export const haltReasonSchema = z.object({
	code: z.enum(haltCodes),
	/** 出事的节点（或触发器）id，如果有的话。 */
	node: z.string().min(1).optional(),
	/** 自由文本，给人看。 */
	detail: z.string(),
	/** 停住发生的时间，ISO 8601。 */
	at: z.iso.datetime(),
});

export type HaltReason = z.infer<typeof haltReasonSchema>;
