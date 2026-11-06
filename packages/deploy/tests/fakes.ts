import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

async function bodyOf(req: IncomingMessage): Promise<unknown> {
	let text = "";
	for await (const chunk of req) text += chunk;
	return text === "" ? {} : JSON.parse(text);
}

async function listen(server: Server): Promise<string> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export type Sent = { token: string; chatId: number; text: string };

/**
 * 假的 Telegram Bot API：按 token 分开的更新队列。`getUpdates` 有就给、没有就等一小会儿给空，
 * `sendMessage` 记下来。
 */
export async function fakeTelegram() {
	const queues = new Map<string, unknown[]>();
	const sent: Sent[] = [];
	let nextUpdate = 1;
	const server = createServer((req, res) => {
		void (async () => {
			const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
			const body = (await bodyOf(req)) as Record<string, unknown>;
			const reply = (result: unknown) => {
				res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));
			};
			const [, token = "", method] = match ?? [];
			if (method === "getMe") return reply({ username: `bot_${token}` });
			if (method === "sendMessage") {
				sent.push({ token, chatId: body.chat_id as number, text: body.text as string });
				return reply({ message_id: sent.length });
			}
			if (method === "getUpdates") {
				const queue = queues.get(token) ?? [];
				if (queue.length === 0) await new Promise((resolve) => setTimeout(resolve, 30));
				return reply(queue.splice(0));
			}
			res.writeHead(404).end(JSON.stringify({ ok: false, description: "not found" }));
		})();
	});
	const url = await listen(server);
	return {
		url,
		sent,
		say(token: string, chatId: number, text: string) {
			const id = nextUpdate++;
			const queue = queues.get(token) ?? [];
			queue.push({
				update_id: id,
				message: { message_id: id, chat: { id: chatId }, from: { username: "tester" }, text },
			});
			queues.set(token, queue);
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/** 假的 OpenAI 兼容端点：把最后一句 user 说的话加上前缀回出去。 */
export async function fakeOpenAI(prefix = "echo: ") {
	const server = createServer((req, res) => {
		void (async () => {
			const body = (await bodyOf(req)) as { model: string; messages: { role: string; content: unknown }[] };
			const last = [...body.messages].reverse().find((message) => message.role === "user");
			const content = last?.content;
			const text =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content.map((part) => (part as { text?: string }).text ?? "").join("")
						: "";
			res.writeHead(200, { "content-type": "application/json" }).end(
				JSON.stringify({
					id: "c",
					object: "chat.completion",
					created: 0,
					model: body.model,
					choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `${prefix}${text}` } }],
				}),
			);
		})();
	});
	const url = await listen(server);
	return { url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
