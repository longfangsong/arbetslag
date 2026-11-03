import { z } from "zod";
import { type AnyMatcherDefinition, defineMatcher, matchSpecSchema } from "../trigger/matcher.ts";

/** 省略 `match` 的订阅就是它：这个监听器上的全部事件。 */
export const alwaysMatcher = defineMatcher({
	name: "always",
	config: z.unknown(),
	match: () => true,
});

const childrenSchema = z.object({ of: z.array(matchSpecSchema).min(1) });

export const allMatcher = defineMatcher({
	name: "all",
	config: childrenSchema,
	match: (_event, config, nested) => config.of.every(nested),
	children: (config) => config.of,
});

export const anyMatcher = defineMatcher({
	name: "any",
	config: childrenSchema,
	match: (_event, config, nested) => config.of.some(nested),
	children: (config) => config.of,
});

/** 框架自带的匹配函数：注册表总有它们，宿主不用也不能再注册同名的。 */
export const builtinMatchers: AnyMatcherDefinition[] = [alwaysMatcher, allMatcher, anyMatcher];
