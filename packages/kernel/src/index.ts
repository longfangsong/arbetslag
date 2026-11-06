import type z from "zod";
import type { Repository as NodeDefinitionRepository } from "./nodeDefinition";
import type { Store } from "./store";
import type { Repository as TriggerDefinitionRepository } from "./triggerDefinition";
import { Graph, type schema as graphSchema } from "./workflow";

export interface Context {
    nodeDefinitionRepository: NodeDefinitionRepository;
    triggerDefinitionRepository: TriggerDefinitionRepository;
}

export async function onExternalEvent(store: Store, context: Context, externalEvent: any) {
    const graphs =
        (await store.get<Array<z.infer<typeof graphSchema>>>("graphs"))
            .map(Graph.deserialize);
    await Promise.all(
        graphs.map(it => it.putExternalEvent(context, externalEvent))
    );
    await store.set("graphs", graphs.map(graph => graph.serialize()));
}
