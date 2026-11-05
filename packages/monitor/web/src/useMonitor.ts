import { useEffect, useState } from "react";
import type { UnreadyEntry, WorkflowSummary } from "../../src/protocol.ts";
import { connect } from "./transport.ts";

export type MonitorState = {
	connected: boolean;
	/** 收到第一条 `overview` 之前是 `undefined`。 */
	workflows: Map<string, WorkflowSummary> | undefined;
	unready: UnreadyEntry[];
	/** 每份工作流最近一次被推送的时刻：详情页据此重新拉快照。 */
	touched: Map<string, number>;
};

export function useMonitor(): MonitorState {
	const [state, setState] = useState<MonitorState>({
		connected: false,
		workflows: undefined,
		unready: [],
		touched: new Map(),
	});

	useEffect(
		() =>
			connect({
				onConnection: (connected) => setState((s) => ({ ...s, connected })),
				onEvent: (message) =>
					setState((prev) => {
						// 收到事件就说明连着：别只信 `onopen`。
						const s = { ...prev, connected: true };
						switch (message.event) {
							case "overview":
								return {
									...s,
									workflows: new Map(message.data.workflows.map((w) => [w.id, w])),
									unready: message.data.unready,
								};
							case "workflow": {
								const workflows = new Map(s.workflows);
								workflows.set(message.data.id, message.data);
								const touched = new Map(s.touched);
								touched.set(message.data.id, Date.now());
								return { ...s, workflows, touched };
							}
							case "unready":
								return { ...s, unready: message.data };
						}
					}),
			}),
		[],
	);

	return state;
}
