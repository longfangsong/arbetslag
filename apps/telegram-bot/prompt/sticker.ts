export interface Sticker {
	/** Short internal ID the model references, e.g. "encourage". */
	id: string;
	/** Telegram file_id, resolved at send time via sendSticker. */
	fileId: string;
	/** When / in what mood this sticker fits. */
	description: string;
}

export const STICKERS: Sticker[] = [
	{
		id: "gloom",
		fileId:
			"CAACAgUAAxkBAAFTx5VqoHDcF3HX8C1Qv-wrPQABXruVCsUAArYVAALFZJFWzhqrmoDTunQ9BA",
		description: "当用户 发送 核战争、第三次世界大战 相关信息 时直接跟着发送",
	},
	{
		id: "unfair",
		fileId:
			"CAACAgUAAxkBAAFTx8xqoHVmP6FdCn5g8Ooj39ogoyReZAACJQQAAjnZQFUERyet5zZsZD0E",
		description: "当用户抱怨不公平时直接跟着发送",
	},
	{
		id: "hurt",
		fileId:
			"CAACAgUAAxkBAAFTx9ZqoHYXfoXTnwGw79uBeCgUYw7OhwACRgwAAou5-FaHi0cbH8Vjoj0E",
		description: "当用户辱骂你，你因为用户的发言伤心时直接发送",
	},
	{
		id: "lucky",
		fileId:
			"CAACAgUAAxkBAAFTx95qoHaNzPCzLdZLk1vm-B9C6mWqpgACfxoAAhyUwFdMgRKEfgXF2z0E",
		description: "当你觉得群友运气太好时直接发送",
	},
	{
		id: "encourage",
		fileId:
			"CAACAgUAAxkBAAFTx-JqoHa3198Gljyg3DFUfAgUS5-r2wACmhkAAnKiwVduR5g3lDZELj0E",
		description: "当群友准备放弃**某个具体事情**时发送，鼓励他继续努力",
	},
	{
		id: "rich",
		fileId:
			"CAACAgUAAxkBAAFTx_FqoHcKIrvYyIdMuxVeyobHoi76UQAClxcAAizOwVcURuooa9dUqj0E",
		description: "当群友发财了时直接发送",
	},
	{
		id: "immoral",
		fileId:
			"CAACAgUAAxkBAAFTx_hqoHdGzoHnZTTMLbbYouvpDSplJAACNBkAAuQEwVdYcum_jMIXHz0E",
		description: "当群友的发言不太道德时直接发送",
	},
	{
		id: "bad-news",
		fileId:
			"CAACAgUAAxkBAAFTyAABaqB3jTmvJp6ht2GDOSOKG6SbL5IAAtQYAAJvl8hXRKMAARHoKMsUPQQ",
		description: "当听到不好的消息时直接发送",
	},
];
