import {
  ExternalEventSource,
  IncomingExternalEvent,
} from "../../model/externalEventSource";
import { Update } from "@grammyjs/types";
import { ExternalEventHandlerFactory } from "../../model/externalEventSource";
import {
  ExternalEventDispatcherFactory,
  ExternalEventTarget,
  OutgoingExternalEvent,
} from "../../model/externalEventTarget";
import { Reducer } from "../..";
import { State } from "../../model/state";
import { Jsonifiable } from "type-fest";
import { nanoid } from "../../utils";

export type TelegramSystemSpecificInfo = {
  chatId: string;
};

export type TelegramIncomingExternalEvent =
  IncomingExternalEvent<TelegramSystemSpecificInfo> & {
    externalSystemId: "telegram";
    update: Update;
  };

export type TelegramOutgoingExternalEvent =
  OutgoingExternalEvent<TelegramSystemSpecificInfo> & {
    externalSystemId: "telegram";
    content: string;
  };

export class TelegramEventDispatcherFactory
  implements ExternalEventDispatcherFactory<TelegramSystemSpecificInfo>
{
  externalSystemId = "telegram";
  deserizeIntoReducer(
    target: ExternalEventTarget<TelegramSystemSpecificInfo>,
  ): Reducer<TelegramOutgoingExternalEvent> {
    return {
        call: async (
            state: State,
            event: TelegramOutgoingExternalEvent,
        ): Promise<State> => {
            if (event.systemSpecificInfo.chatId !== target.systemSpecificInfo.chatId) {
                return state;
            }
            // do tg send here
            return state;
        }
    }
  }
  private isCreatedByThisFactory(
    target: ExternalEventTarget<Jsonifiable>,
  ): target is ExternalEventTarget<TelegramSystemSpecificInfo> {
    return target.externalSystemId === "telegram";
  }
  private isCreatedByDualFactory(
    target: ExternalEventSource<Jsonifiable>,
  ): target is ExternalEventSource<TelegramSystemSpecificInfo> {
    return target.externalSystemId === "telegram";
  }
  async call(
    state: State,
    event: OutgoingExternalEvent<TelegramSystemSpecificInfo>,
  ): Promise<State> {
    if (event.externalSystemId !== "telegram") {
      return state;
    }
    const existingTarget = state.persistent.externalEventTargets.find(
      (it) =>
        this.isCreatedByThisFactory(it) &&
        it.systemSpecificInfo.chatId === event.systemSpecificInfo.chatId,
    );
    if (existingTarget !== undefined) {
      return state;
    }
    const agentId = state.persistent.externalEventSources.find(
      (it) =>
        this.isCreatedByDualFactory(it) &&
        it.extraInfo.chatId === event.systemSpecificInfo.chatId,
    )!.toAgentId;
    const createdTarget: ExternalEventTarget<TelegramSystemSpecificInfo> = {
        id: nanoid(),
        externalSystemId: "telegram",
        fromAgentId: agentId,
        systemSpecificInfo: {
            chatId: event.systemSpecificInfo.chatId
        }
    };
    state.persistent.externalEventTargets.push(createdTarget);
    // todo: re-dispatch the event?
    return state;
  }
}
