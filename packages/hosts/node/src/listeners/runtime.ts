import type { JsonValue } from "type-fest";

/**
 * 部署配置里的一个外部事件源（ADR-0015）：一个 bot token、一条 webhook 路径，恰好一个。
 * 它不在任何快照里，图改不了它；`kind` 与触发器种类同名。密钥不放 `config`，放 runtime 的选项。
 */
export type Listener = { id: string; kind: string; config: JsonValue };

/**
 * 监听器交给路由的一条外部事件。`eventId` 是来源自带的事件 id（Telegram 的 `update_id`），
 * 路由拿它在发件箱上去重；没有就不给。
 */
export type ListenerEvent = { output: string; body: JsonValue; eventId?: string };

export type ListenerHooks = {
	/**
	 * 交给路由：resolve 时事件已经写进发件箱，监听器这才向来源确认（回 200、推进 offset）。
	 * reject 就不确认，让来源重投。
	 */
	emit(event: ListenerEvent): Promise<unknown>;
	/**
	 * 监听一开始是好的、后来坏了（端口掉了、连接断了）。宿主记**未就绪**并重开。
	 * 起不来（`open` 失败）走抛错，不走这里。
	 */
	unready(reason: string): void;
};

/** 一个活着的监听。关掉之后宿主不会再管它。 */
export type ListenerHandle = { close(): Promise<void> };

/**
 * 一种监听器在宿主里的实现（每个平台各写一份：Node 是 http / 长轮询，Workers 是一条路由）。
 * 内核不认识它：内核只认触发器种类的名字与 schema。
 */
export type ListenerRuntime<Handle extends ListenerHandle = ListenerHandle> = {
	kind: string;
	open(listener: Listener, hooks: ListenerHooks): Promise<Handle>;
};

/** 按种类查实现；没有就是当前部署没实现这个种类。 */
export type ListenerRuntimes = Readonly<Record<string, ListenerRuntime | undefined>>;

/** 监听器声明合法但起不来（token 被拒、端口被占）：**未就绪**，部署级，不涉及任何工作流。 */
export class ListenerUnready extends Error {
	readonly listener: string;
	/** 给未就绪报告用的一句话（不带前缀）。 */
	readonly reason: string;

	constructor(listener: string, reason: string) {
		super(`listener ${JSON.stringify(listener)} is unready: ${reason}`);
		this.name = "ListenerUnready";
		this.listener = listener;
		this.reason = reason;
	}
}
