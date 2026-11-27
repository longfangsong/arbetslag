import z from "zod";
import { schema as nodeSchema } from "./node";
import { schema as edgeSchema, type Edge } from "./edge";
import { TriggerSubscription, schema as triggerSchema } from "./triggerSubscription";
import { Node } from "./node";
import type { Context } from "..";
import type { Message } from "../message";
import { newId } from "../utils";

export const schema = z.object({
  id: z.string().min(1),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  triggers: z.array(triggerSchema),
});

export class Graph {
  id: string;
  nodes: Array<Node>;
  edges: Array<Edge>;
  triggerSubscriptions: Array<TriggerSubscription>;
  // system messages
  inbox: Array<Message>;

  constructor(
    id: string,
    nodes: Array<Node>,
    edges: Array<Edge>,
    triggers: Array<TriggerSubscription>,
  ) {
    this.id = id;
    this.nodes = nodes;
    this.edges = edges;
    this.triggerSubscriptions = triggers;
    this.inbox = [];
  }

  serialize(): z.infer<typeof schema> {
    return {
      id: this.id,
      nodes: this.nodes.map((node) => node.serialize()),
      edges: this.edges,
      triggers: this.triggerSubscriptions.map((trigger) => trigger.serialize()),
    };
  }

  static deserialize(data: z.infer<typeof schema>): Graph {
    return new Graph(
      data.id,
      data.nodes.map((nodeData) => Node.deserialize(nodeData)),
      data.edges,
      data.triggers.map((triggerData) =>
        TriggerSubscription.deserialize(triggerData),
      ),
    );
  }

  private deliver(context: Context, message: Message) {
    const edges = this.edges.filter(
      (it) => it.from === message.from && it.type === message.type,
    );
    for (const edge of edges) {
      switch (edge.to) {
        case "broadcast": {
          this.nodes.forEach((it) => it.inputBox.push(message));
          break;
        }
        case "system": {
          this.inbox.push(message);
          break;
        }
        default: {
          for (const target of edge.to) {
            this.nodes.find((it) => it.id === target)?.inputBox.push(message);
          }
        }
      }
    }
  }

  private busyNodes(): Array<Node> {
    return this.nodes.filter((it) => it.inputBox.length > 0);
  }

  private handleSystemMessage(context: Context, message: Message) {
    switch (message.type) {
      case "createNode": {
        const definitionName = message["definitionName"] as string;
        const node = Node.create(context, definitionName, message["config"] ?? null);
        this.nodes.push(node);
        this.deliver(context, {
          id: newId(),
          type: "nodeCreated",
          from: "system",
          to: message.from,
          nodeId: node.id,
        });
        break;
      }
      case "createEdge": {
        const edgeFrom = message["edgeFrom"] as string;
        const edgeTo = message["edgeTo"] as string;
        const edgeType = message["edgeType"] as string;
        const existingEdge = this.edges.find(
          (it) => it.from === edgeFrom && it.type === edgeType,
        );
        if (existingEdge) {
          if (!Array.isArray(existingEdge.to)) {
            throw new Error(
              `cannot add edge from ${edgeFrom} (${edgeType}): it already targets ${existingEdge.to}`,
            );
          }
          if (!existingEdge.to.includes(edgeTo)) {
            existingEdge.to.push(edgeTo);
          }
        } else {
          this.edges.push({
            from: edgeFrom,
            to: [edgeTo],
            type: edgeType,
          });
        }
        this.deliver(context, {
          id: newId(),
          type: "edgeCreated",
          from: "system",
          to: message.from,
        });
        break;
      }
      case "deleteNode": {
        const id = message["id"] as string;
        this.nodes = this.nodes.filter((it) => it.id !== id);
        this.edges.forEach((it) => {
          if (it.from === id) {
            it.to = [];
          }
          if (Array.isArray(it.to)) {
            it.to = it.to.filter((to) => to !== id);
          }
        });
        this.edges = this.edges.filter(
          (edge) => !(Array.isArray(edge.to) && edge.to.length === 0),
        );
        this.deliver(context, {
          id: newId(),
          type: "nodeDeleted",
          from: "system",
          to: message.from,
        });
        break;
      }
      case "deleteEdge": {
        const from = message["from"] as string;
        const to = message["to"] as string;
        const type = message["type"] as string;
        const edge = this.edges.find(
          (it) => it.from === from && it.type === type,
        );
        if (Array.isArray(edge?.to)) {
          edge.to = edge.to.filter((it) => it !== to);
          if (edge.to.length === 0) {
            this.edges = this.edges.filter((it) => it !== edge);
          }
        }
        this.deliver(context, {
          id: newId(),
          type: "edgeDeleted",
          from: "system",
          to: message.from,

          edgeFrom: from,
          edgeTo: to,
          edgeType: type,
        });
        break;
      }
    }
  }

  async stepUntilIdle(context: Context, message: Message) {
    this.deliver(context, message);
    await this.stepAllNodes(context);
    // 处理系统消息时新投递进来的系统消息留在新的 inbox 里，不能丢
    while (this.inbox.length > 0) {
      const systemMessages = this.inbox;
      this.inbox = [];
      for (const systemMessage of systemMessages) {
        this.handleSystemMessage(context, systemMessage);
      }
      await this.stepAllNodes(context);
    }
  }

  private async stepAllNodes(context: Context) {
    let busyNodes = this.busyNodes();
    while (busyNodes.length > 0) {
      const newMessages = (
        await Promise.all(busyNodes.map((it) => it.stepUntilEmpty(context)))
      ).flat();
      newMessages.map((it) => this.deliver(context, it));
      busyNodes = this.busyNodes();
    }
  }
}
