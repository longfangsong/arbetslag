import { z } from "zod";
import { defineMatcher } from "@arbetslag/kernel";

/**
 * 框架预置的匹配函数（ADR-0015）：同步、纯、便宜。`always` / `all` / `any` 随内核注册表自带，
 * 这里是看载荷的几个；应用要用就把它们放进 `createRegistry({ matchers })`。
 * 它们只读载荷里约定俗成的字段（`chatId`、`from`、`text`），字段缺席就是不匹配。
 */

const field = (body: unknown, name: string): unknown =>
	typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;

/** 只要某个 chat 的事件（Telegram 的 `chatId`）。 */
export const chatIs = defineMatcher({
	name: "chatIs",
	config: z.object({ chatId: z.number().int() }),
	match: (event, config) => field(event.body, "chatId") === config.chatId,
});

/** 只要某个发件人的事件（载荷里的 `from`）。 */
export const fromUser = defineMatcher({
	name: "fromUser",
	config: z.object({ username: z.string().min(1) }),
	match: (event, config) => field(event.body, "from") === config.username,
});

/** 载荷里的 `text` 匹配一个正则。 */
export const textMatches = defineMatcher({
	name: "textMatches",
	config: z.object({ pattern: z.string(), flags: z.string().regex(/^[dgimsuvy]*$/).default("") }),
	match: (event, config) => {
		const text = field(event.body, "text");
		return typeof text === "string" && new RegExp(config.pattern, config.flags).test(text);
	},
});

export const presetMatchers = [chatIs, fromUser, textMatches];
