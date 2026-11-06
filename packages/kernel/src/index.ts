import type { Repository as NodeDefinitionRepository } from "./nodeDefinition";
import type { Repository as EffectHandlerDefinitionRepository } from "./effectHandler";
import type { Repository as TriggerDefinitionRepository } from "./triggerDefinition";

export interface Host {
    nodeDefinitionRepository: NodeDefinitionRepository;
    effectHandlerDefinitionRepository: EffectHandlerDefinitionRepository;
    triggerDefinitionRepository: TriggerDefinitionRepository;
}
