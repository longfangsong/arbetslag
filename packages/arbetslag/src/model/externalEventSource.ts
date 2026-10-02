import type { Jsonifiable } from "type-fest";
import type { Event, Reducer } from "..";

export interface IncomingExternalEvent<ExtraInfo extends Jsonifiable>
  extends Event {
  type: "incomingExternalEvent";
  id: string;
  externalSystemId: string;
  extraInfo: ExtraInfo;
}

export interface ExternalEventSource<ExtraInfo extends Jsonifiable> {
  id: string;
  externalSystemId: string;
  toAgentId: string;
  extraInfo: ExtraInfo;
}

export interface ExternalEventHandlerFactory<ExtraInfo extends Jsonifiable>
  extends Reducer<IncomingExternalEvent<ExtraInfo>> {
  externalSystemId: string;
  deserizeIntoReducer(
    source: ExternalEventSource<ExtraInfo>,
  ): Reducer<IncomingExternalEvent<ExtraInfo>>;
}
