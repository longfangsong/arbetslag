import type { HaltReason, InstantiateViolation, Snapshot } from "@arbetslag/kernel";

/**
 * 监控的线上协议（ADR-0017）：浏览器只认这里的形状，不认宿主。
 * Node 宿主与将来的 Workers 宿主各写一份服务端，前端不变。
 *
 * - `GET  /api/workflows`      → `Overview`
 * - `GET  /api/workflows/:id`  → `WorkflowDetail`；没有这份工作流 404
 * - `POST /api/workflows`      `CreateRequest` → 201 `{ id }`；不合规 400 / id 已存在 409，都是 `CreateRefusal`
 * - `GET  /api/events`         → SSE：先一条 `overview`，之后 `workflow` / `unready` 增量（`MonitorEvent`）
 */

/** 由快照推导、不存储（`CONTEXT.md` 的「停住」「可推进」「等回执」「静止」）。 */
export type WorkflowStatus = "halted" | "runnable" | "in_flight" | "quiescent";

export type WorkflowSummary = {
	id: string;
	status: WorkflowStatus;
	halted?: HaltReason;
	nodes: number;
	triggers: number;
	/** 全部邮箱里的消息条数。 */
	mailbox: number;
	/** 快照里的在飞效果条数。 */
	inFlight: number;
	/** 其中此刻真的交给 Performer 在执行的条数。 */
	executing: number;
};

/** 宿主侧暂时生效不了的东西（`CONTEXT.md` 的「未就绪」）。 */
export type UnreadyEntry =
	| { scope: "listener"; listener: string; reason: string }
	| { scope: "trigger"; workflowId: string; trigger: string; reason: string };

export type Overview = { workflows: WorkflowSummary[]; unready: UnreadyEntry[] };

export type WorkflowDetail = {
	summary: WorkflowSummary;
	snapshot: Snapshot;
	/** 此刻正在执行的 `effectId`。 */
	executing: string[];
};

export type CreateRequest = { template: unknown; id?: string };

export type CreateRefusal =
	| { code: "request_invalid"; detail: string }
	| { code: "template_invalid"; violations: InstantiateViolation[] }
	| { code: "workflow_exists"; id: string };

export type MonitorEvent =
	| { event: "overview"; data: Overview }
	| { event: "workflow"; data: WorkflowSummary }
	| { event: "unready"; data: UnreadyEntry[] };
