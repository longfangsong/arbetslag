import type { MonitorEvent } from "../../src/protocol.ts";

/**
 * 实时通道（ADR-0017）：协议只定事件的形状，不定载体。Node 宿主用 SSE；
 * 换成 WebSocket 的宿主只改这一个文件，`onEvent` 收到的东西不变。
 */
export type Transport = {
	onEvent: (event: MonitorEvent) => void;
	onConnection: (connected: boolean) => void;
};

const EVENTS: readonly MonitorEvent["event"][] = ["overview", "workflow", "unready"];

/** 返回关闭函数。断线由 `EventSource` 自己重连，重连后服务端会再发一条 `overview`。 */
export function connect({ onEvent, onConnection }: Transport): () => void {
	const source = new EventSource("api/events");
	source.onopen = () => onConnection(true);
	source.onerror = () => onConnection(false);
	for (const event of EVENTS) {
		source.addEventListener(event, (message) => {
			onEvent({ event, data: JSON.parse((message as MessageEvent<string>).data) } as MonitorEvent);
		});
	}
	return () => source.close();
}
