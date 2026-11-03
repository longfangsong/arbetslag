import type { JsonValue } from "type-fest";
import { z } from "zod";
import { formatIssues } from "../failure/issues.ts";
import { jsonSchema } from "../message.ts";

/**
 * 订阅里引用一个匹配函数（ADR-0015）：名字 + config。快照里只存这两样，从不存代码。
 * `config` 省略时按 `undefined` 交给匹配函数的 config schema 解析。
 */
export type MatchSpec = { fn: string; config?: JsonValue };

export const matchSpecSchema: z.ZodType<MatchSpec> = z.object({
	fn: z.string().min(1),
	config: jsonSchema.optional(),
});

/** 匹配函数看到的那条外部事件：监听器交给路由的输出名与载荷。 */
export type MatchEvent = { output: string; body: JsonValue };

/**
 * 注册表里的第四种东西（ADR-0015）：名字、config schema、一个同步纯函数。
 * 组合型的匹配函数（`all` / `any`）用 `children` 交出它引用的子匹配，内核据此递归校验，
 * 求值时用 `nested` 递归。
 */
export type MatcherDefinition<Config = unknown> = {
	name: string;
	config: z.ZodType<Config>;
	match(event: MatchEvent, config: Config, nested: (spec: MatchSpec) => boolean): boolean;
	children?(config: Config): MatchSpec[];
};

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
export type AnyMatcherDefinition = MatcherDefinition<any>;

/** 只为类型推断：运行时原样返回。 */
export function defineMatcher<Config>(definition: MatcherDefinition<Config>): MatcherDefinition<Config> {
	return definition;
}

/** 路由时匹配函数找不到（部署删了它）：按不匹配处理，由调用方报告。 */
export class UnknownMatcher extends Error {
	readonly fn: string;
	constructor(fn: string) {
		super(`no matcher named ${JSON.stringify(fn)}`);
		this.name = "UnknownMatcher";
		this.fn = fn;
	}
}

type MatcherLookup = { matcher(name: string): AnyMatcherDefinition | undefined };

/** 校验一个匹配引用（递归）：名字已注册、config 合 schema。合规返回 `undefined`。 */
export function checkMatchSpec(registry: MatcherLookup, spec: MatchSpec): string | undefined {
	const definition = registry.matcher(spec.fn);
	if (definition === undefined) return `unknown matcher ${JSON.stringify(spec.fn)}`;
	const config = definition.config.safeParse(spec.config);
	if (!config.success) return `matcher ${JSON.stringify(spec.fn)}: ${formatIssues(config.error)}`;
	for (const child of definition.children?.(config.data) ?? []) {
		const problem = checkMatchSpec(registry, child);
		if (problem !== undefined) return problem;
	}
	return undefined;
}

/**
 * 求值：省略即全部。匹配函数未注册抛 `UnknownMatcher`；匹配函数自己抛的错原样抛出。
 * 两种都由路由接住、按不匹配处理并报告（ADR-0015）。
 */
export function evaluateMatch(registry: MatcherLookup, spec: MatchSpec | undefined, event: MatchEvent): boolean {
	if (spec === undefined) return true;
	const definition = registry.matcher(spec.fn);
	if (definition === undefined) throw new UnknownMatcher(spec.fn);
	const config = definition.config.parse(spec.config);
	return definition.match(event, config, (child) => evaluateMatch(registry, child, event));
}
