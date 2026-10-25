import type { HaltReason } from "./halt.ts";

/** 没有这个 id 的工作流（从未创建，或已被 drop）。 */
export class WorkflowNotFound extends Error {
	readonly id: string;
	constructor(id: string) {
		super(`no such workflow: ${JSON.stringify(id)}`);
		this.name = "WorkflowNotFound";
		this.id = id;
	}
}

/** 工作流已停住，外部投递被拒（ADR-0008）；由触发器实现方决定重试或丢弃。 */
export class WorkflowHalted extends Error {
	readonly id: string;
	readonly reason: HaltReason;
	constructor(id: string, reason: HaltReason) {
		super(`workflow ${JSON.stringify(id)} is halted: ${reason.code}`);
		this.name = "WorkflowHalted";
		this.id = id;
		this.reason = reason;
	}
}

/** 投递本身不合规（目标不存在、类别用了 `@`、body 不符合触发器输出的 schema）。 */
export class InvalidDelivery extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidDelivery";
	}
}
