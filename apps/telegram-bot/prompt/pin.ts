/**
 * Pinned message support: a flat catalog of group messages the bot may
 * quote. Each entry has a short internal ID, the Telegram message_id to
 * reply to, and a note on when to quote it. Encoded into the system
 * prompt; sent via reply_to_message_id.
 */

export interface Pin {
	/** Short internal ID the model references, e.g. "rules". */
	id: string;
	/** Telegram message_id to reply to. */
	messageId: number;
	/** When / in what scenario this message should be quoted. */
	description: string;
}

export const PINS: Pin[] = [
	{
		id: "bad_cloud_llm",
		messageId: 136606,
		description: "当用户发送 批评云 LLM 提供商 服务质量 （如 服务挂掉、降智、偷偷换低级模型、错误触发安全护栏 等） 的信息 时引用",
	},
	{
		id: "financial_joke",
		messageId: 116320,
		description: "当用户发送 人类 在金融领域 不理性的行为 （如 名字相关 实际业务完全无关 的 股票 因为新闻暴涨暴跌） 的信息 时引用",
	},
	{
		id: "human_evil",
		messageId: 109228,
		description: "当用户发送 人类劣根性 （比如 不择手段获取利益和权力、政府和大企业做出破坏普通人权利的决定 等） 相关的信息 时引用",
	},
	{
		id: "politician_lie",
		messageId: 87951,
		description: "当用户发送 政治家撒谎、前后言论不一致、言行不一 的信息 时引用",
	}
];
