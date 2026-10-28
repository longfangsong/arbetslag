import type { JsonValue } from "type-fest";
import {
	type ModelCompleteInput,
	type ModelCompleteResult,
	modelCompleteInputSchema,
} from "@arbetslag/agents";

/**
 * 一次模型调用（ADR-0009）：厂商无关的输入 → 一条 assistant 消息或一句失败原因。
 * 各厂商的 Performer（`@arbetslag/llm/openai` 之类）实现这一种签名，翻译 history 是它的事。
 */
export type ModelCall = (request: { input: ModelCompleteInput; workflowId: string }) => Promise<ModelCompleteResult>;

/** 宿主 `Performers` 认的形状（与 executor 的 `Performer` 结构相同，这里不依赖宿主包）。 */
export type PerformModel = (input: JsonValue, context: { workflowId: string }) => Promise<JsonValue>;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 把一次模型调用包成 `model.complete` 的 **Performer**：
 * 先按 `model.complete` 的 input schema 收口，再把抛错转成 `{ ok: false }`——
 * 失败是正常结果，不是宿主故障（ADR-0006）。
 */
export function modelPerformer(call: ModelCall): PerformModel {
	return async (input, context) => {
		const parsed = modelCompleteInputSchema.safeParse(input);
		if (!parsed.success) {
			return { ok: false, error: `bad model.complete input: ${parsed.error.message}` };
		}
		try {
			return await call({ input: parsed.data, workflowId: context.workflowId });
		} catch (error) {
			return { ok: false, error: describe(error) };
		}
	};
}

export type { ModelCompleteInput, ModelCompleteResult };
