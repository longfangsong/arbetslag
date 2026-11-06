import type z from "zod";
import type { Repository as NodeDefinitionRepository } from "./nodeDefinition";
import type { Store } from "./store";
import type { Repository as TriggerRepository } from "./trigger";
import { Graph, type schema as graphSchema } from "./workflow";

export type { Store } from "./store";
export type { Trigger } from "./trigger";
export { TriggerSubscription as TriggerConfig } from "./workflow/triggerSubscription";
export type { Message } from "./message";
export { Graph } from "./workflow";

export interface Context {
  nodeDefinitionRepository: NodeDefinitionRepository;
  triggerRepository: TriggerRepository;
  store: Store;
}

// export async function onExternalEvent(
//   store: Store,
//   context: Context,
//   externalEvent: any,
// ) {
//   let serializedGraphs: Array<z.infer<typeof graphSchema>>;
//   try {
//     serializedGraphs =
//       await store.get<Array<z.infer<typeof graphSchema>>>("graphs");
//   } catch {
//     serializedGraphs = [];
//   }
//   const graphs = serializedGraphs.map(Graph.deserialize);
//   await Promise.all(
//     graphs.map((it) => it.putExternalEvent(context, externalEvent)),
//   );
//   await store.set(
//     "graphs",
//     graphs.map((graph) => graph.serialize()),
//   );
// }
