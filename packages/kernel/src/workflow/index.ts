import z from "zod";
import { schema as nodeSchema } from "./node";
import { schema as edgeSchema, type Edge } from "./edge";
import { Trigger, schema as triggerSchema } from "./trigger";
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
  triggers: Array<Trigger>;
  // system messages
  inbox: Array<Message>;

  constructor(
    id: string,
    nodes: Array<Node>,
    edges: Array<Edge>,
    triggers: Array<Trigger>,
  ) {
    this.id = id;
    this.nodes = nodes;
    this.edges = edges;
    this.triggers = triggers;
    this.inbox = [];
  }

  serialize(): z.infer<typeof schema> {
    return {
      id: this.id,
      nodes: this.nodes.map((node) => node.serialize()),
      edges: this.edges,
      triggers: this.triggers.map((trigger) => trigger.serialize()),
    };
  }

  static deserialize(data: z.infer<typeof schema>): Graph {
    return new Graph(
      data.id,
      data.nodes.map((nodeData) => Node.deserialize(nodeData)),
      data.edges,
      data.triggers.map((triggerData) => Trigger.deserialize(triggerData)),
    );
  }

  private deliver(context: Context, message: Message) {
    const edges = this.edges.filter(
      (it) => it.from === message.from && it.type === message.type,
    );
    for (let edge of edges) {
      switch (edge.to) {
        case "broadcast": {
          this.nodes.forEach((it) => it.inputBox.push(message));
          break;
        }
        case "system":
          this.inbox.push(message);
          break;
        default: {
          for (let target of edge.to) {
            this.nodes.find((it) => it.id === target)?.inputBox.push(message);
          }
        }
      }
    }
  }

  busyNodes(): Array<Node> {
    return this.nodes.filter((it) => it.inputBox.length > 0);
  }

  handleSystemMessage(context: Context, message: Message) {
    switch (message.type) {
      case "createNode":
        const definitionName = message["definitionName"] as string;
        const node = Node.create(context, definitionName, message["config"]!);
        this.nodes.push(node);
        this.deliver(context, {
          id: newId(),
          type: "nodeCreated",
          from: "system",
          to: message.from,
          nodeId: node.id,
        });
        break;
      case "createEdge":
        const edgeFrom = message["edgeFrom"] as string;
        const edgeTo = message["edgeTo"] as string;
        const edgeType = message["edgeType"] as string;
        const existingEdge = this.edges.find(
          (it) => it.from === edgeFrom && it.type === edgeTo,
        );
        if (existingEdge) {
          if (!Array.isArray(existingEdge.to)) {
            throw "todo: implement error handling";
          }
          existingEdge.to.push(edgeTo);
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
      case "deleteNode":
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
  }

  async putExternalEvent(context: Context, event: any) {
    for (const trigger of this.triggers) {
      const message = await trigger.convert(context, event);
      if (message) {
        this.deliver(context, message);
        await this.stepAllNodes(context);
      }
    }
    while (this.inbox.length > 0) {
      this.inbox.forEach((it) => this.handleSystemMessage(context, it));
      this.inbox = [];
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
