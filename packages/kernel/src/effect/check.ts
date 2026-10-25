import { formatIssues } from "../issues.ts";
import type { Registry } from "../registry.ts";
import type { EffectRequest } from "./request.ts";

/** 效果非法的原因；调用方把它们转成停住（ADR-0008）。 */
export type EffectViolation =
	| { code: "effect_kind_unknown"; index: number; kind: string }
	| { code: "effect_input_invalid"; index: number; kind: string; detail: string };

/** step 返回时校验 `effects`：未知 kind、`input` 不合规。内核从不执行效果。 */
export function checkEffects(registry: Registry, effects: EffectRequest[]): EffectViolation[] {
	const violations: EffectViolation[] = [];
	effects.forEach((effect, index) => {
		const definition = registry.effectKind(effect.kind);
		if (definition === undefined) {
			violations.push({ code: "effect_kind_unknown", index, kind: effect.kind });
			return;
		}
		const parsed = definition.input.safeParse(effect.input);
		if (!parsed.success) {
			const detail = formatIssues(parsed.error);
			violations.push({ code: "effect_input_invalid", index, kind: effect.kind, detail });
		}
	});
	return violations;
}
