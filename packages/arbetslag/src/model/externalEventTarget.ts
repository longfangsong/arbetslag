import type { Jsonifiable } from "type-fest";
import type { Event, Reducer } from "..";

export interface OutgoingExternalEvent<SystemSpecificInfo extends Jsonifiable>
  extends Event {
  type: "outgoingExternalEvent";
  id: string;
  externalSystemId: string;
  systemSpecificInfo: SystemSpecificInfo;
}

export interface ExternalEventTarget<SystemSpecificInfo extends Jsonifiable> {
  id: string;
  externalSystemId: string;
  fromAgentId: string;
  systemSpecificInfo: SystemSpecificInfo;
}

export interface ExternalEventDispatcherFactory<
  SystemSpecificInfo extends Jsonifiable,
> extends Reducer<OutgoingExternalEvent<SystemSpecificInfo>> {
  externalSystemId: string;
//   todo: who should call this?
  deserizeIntoReducer(
    target: ExternalEventTarget<SystemSpecificInfo>,
  ): Reducer<OutgoingExternalEvent<SystemSpecificInfo>>;
}
