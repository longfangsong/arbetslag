import z from "zod";
import { schema as nodeSchema } from "./node";
import { schema as edgeSchema, type Edge } from "./edge";
import { Trigger, schema as triggerSchema } from "./trigger";
import { Node } from "./node";
import type { Host } from "..";
import type { Message } from "../message";

export const schema = z.object({
	nodes: z.array(nodeSchema),
	edges: z.array(edgeSchema),
    triggers: z.array(triggerSchema),
});

export class Graph {
	nodes: Array<Node>;
	edges: Array<Edge>;
	triggers: Array<Trigger>;

	constructor(nodes: Array<Node>, edges: Array<Edge>, triggers: Array<Trigger>) {
		this.nodes = nodes;
		this.edges = edges;
		this.triggers = triggers;
	}

	serialize(): z.infer<typeof schema> {
		return {
			nodes: this.nodes.map(node => node.serialize()),
			edges: this.edges,
			triggers: this.triggers.map(trigger => trigger.serialize()),
		};
	}

	static deserialize(data: z.infer<typeof schema>): Graph {
		return new Graph(
			data.nodes.map(nodeData => Node.deserialize(nodeData)),
			data.edges,
			data.triggers.map(triggerData => Trigger.deserialize(triggerData)),
		);
	}

	deliver(host: Host, message: Message) {
		
	}

	async putExternalEvent(host: Host, event: any) {
		for (const trigger of this.triggers) {
			const message = await trigger.convert(host, event);
			if (message) {

			}
		}	
	}
};

