import type z from "zod";
import type { Repository as NodeDefinitionRepository } from "./nodeDefinition";
import type { Store } from "./store";
import type { Repository as TriggerRepository } from "./trigger";
import { Graph, type schema as graphSchema } from "./workflow";
import type { Message } from "./message";

export type { Store } from "./store";
export type { Trigger, Repository as TriggerRepository } from "./trigger";
export { TriggerSubscription as TriggerConfig } from "./workflow/triggerSubscription";
export type { Message } from "./message";
export { Graph } from "./workflow";
export type {
	NodeDefinition,
	Repository as NodeDefinitionRepository,
} from "./nodeDefinition";
export { newId } from "./utils";

const graphsKey = "graphs";

type SerializedGraph = z.infer<typeof graphSchema>;

export interface Context {
	nodeDefinitionRepository: NodeDefinitionRepository;
	triggerRepository: TriggerRepository;
	store: Store;
}

async function loadGraphs(context: Context): Promise<Array<SerializedGraph>> {
	try {
		return await context.store.get<Array<SerializedGraph>>(graphsKey);
	} catch {
		return [];
	}
}

/// 覆盖保存一份图。图列表整体存在同一个 key 下，所以读-改-写。
export async function saveGraph(context: Context, graph: Graph): Promise<void> {
	const graphs = await loadGraphs(context);
	const serialized = graph.serialize();
	const index = graphs.findIndex((it) => it.id === graph.id);
	if (index === -1) {
		graphs.push(serialized);
	} else {
		graphs[index] = serialized;
	}
	await context.store.set(graphsKey, graphs);
}

/// 把一个外部事件投递进图里，然后持久化图的新形态。
export async function deliver(
	context: Context,
	graph: Graph,
	message: Message,
): Promise<void> {
	await graph.stepUntilIdle(context, message);
	await saveGraph(context, graph);
}

export async function start(context: Context) {
	const graphs = (await loadGraphs(context)).map((it) => Graph.deserialize(it));
	for (const graph of graphs) {
		for (const subscription of graph.triggerSubscriptions) {
			if (!context.triggerRepository.get(subscription.triggerName)) {
				throw new Error(
					`Trigger ${subscription.triggerName} of graph ${graph.id} is not registered`,
				);
			}
		}
	}
	for (const trigger of context.triggerRepository.all()) {
		for (const graph of graphs) {
			trigger.connect(graph);
		}
		await trigger.start(context);
	}
}
