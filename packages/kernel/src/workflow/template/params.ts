import type { JsonValue } from "type-fest";
import type { WorkflowTemplate } from "./template.ts";

/** 字符串里的一个占位符：`{{name}}`。只做替换，不求值（ADR-0018）。 */
const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const WHOLE = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/;

export type TemplateParamViolation =
	| { code: "param_undeclared"; name: string }
	| { code: "param_unknown"; name: string }
	| { code: "param_not_scalar"; name: string };

/**
 * 把一个 JSON 值里的占位符换成参数（ADR-0018）：纯函数，不改入参，只替换值、不碰对象的键。
 *
 * - 字符串恰好是 `{{name}}` → 换成参数值本身（类型保留）；
 * - 嵌在字符串里 → 换成参数值的文本，只允许字符串、数字、布尔；
 * - 引用了 `values` 里没有的名字是违规。
 */
export function fillPlaceholders(
	value: JsonValue,
	values: Readonly<Record<string, JsonValue>>,
): { ok: true; value: JsonValue } | { ok: false; violations: TemplateParamViolation[] } {
	const violations: TemplateParamViolation[] = [];
	const reported = new Set<string>();
	const report = (violation: TemplateParamViolation) => {
		const key = `${violation.code}:${violation.name}`;
		if (!reported.has(key)) {
			reported.add(key);
			violations.push(violation);
		}
	};

	const fill = (inner: JsonValue): JsonValue => {
		if (typeof inner === "string") {
			const whole = WHOLE.exec(inner);
			if (whole?.[1] !== undefined) {
				const name = whole[1];
				if (!Object.hasOwn(values, name)) {
					report({ code: "param_undeclared", name });
					return inner;
				}
				return values[name] as JsonValue;
			}
			return inner.replace(PLACEHOLDER, (match, name: string) => {
				if (!Object.hasOwn(values, name)) {
					report({ code: "param_undeclared", name });
					return match;
				}
				const param = values[name];
				if (typeof param === "string" || typeof param === "number" || typeof param === "boolean") {
					return String(param);
				}
				report({ code: "param_not_scalar", name });
				return match;
			});
		}
		if (Array.isArray(inner)) return inner.map(fill);
		if (typeof inner === "object" && inner !== null) {
			return Object.fromEntries(Object.entries(inner).map(([key, v]) => [key, fill(v as JsonValue)]));
		}
		return inner;
	};

	const filled = fill(value);
	return violations.length > 0 ? { ok: false, violations } : { ok: true, value: filled };
}

/**
 * 给带参数的模板填值（ADR-0018）：没给的参数取模板声明的默认值；
 * 给了没声明的、引用了没声明的，都是违规。返回的模板不再有 `params`。
 */
export function fillTemplate(
	template: WorkflowTemplate,
	given: Readonly<Record<string, JsonValue>> = {},
): { ok: true; template: WorkflowTemplate } | { ok: false; violations: TemplateParamViolation[] } {
	const { params: declared = {}, ...rest } = template;
	const unknown: TemplateParamViolation[] = Object.keys(given)
		.filter((name) => !Object.hasOwn(declared, name))
		.map((name) => ({ code: "param_unknown", name }));
	const filled = fillPlaceholders(rest as JsonValue, { ...declared, ...given } as Record<string, JsonValue>);
	const violations = [...unknown, ...(filled.ok ? [] : filled.violations)];
	return violations.length > 0 || !filled.ok
		? { ok: false, violations }
		: { ok: true, template: filled.value as WorkflowTemplate };
}
