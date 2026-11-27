import {
  start,
  type NodeDefinition,
  type NodeDefinitionRepository,
  type Trigger,
  type TriggerRepository,
} from "@arbetslag/kernel";
import { z } from "zod";
import type { JsonValue } from "type-fest";
import { SqliteStore } from "./sqliteStore";
import { WebhookTrigger } from "./webhookTrigger";

class InMemoryNodeDefinitionRepository implements NodeDefinitionRepository {
  private nodes = new Map<string, NodeDefinition<JsonValue, JsonValue>>();
  register(definition: NodeDefinition<JsonValue, JsonValue>): void {
    this.nodes.set(definition.name, definition);
  }
  get(name: string): NodeDefinition<JsonValue, JsonValue> | undefined {
    return this.nodes.get(name);
  }
}

class InMemoryTriggerRepository implements TriggerRepository {
  private triggers: Array<Trigger<JsonValue>> = [];
  register(trigger: Trigger<JsonValue>): void {
    this.triggers.push(trigger);
  }
  get(name: string): Trigger<JsonValue> | undefined {
    return this.triggers.find((it) => it.name === name);
  }
  all(): ReadonlyArray<Trigger<JsonValue>> {
    return this.triggers;
  }
}

// 示例节点：收到消息就把收到的次数记到自己的状态里
const echoNode: NodeDefinition<{ count: number }, Record<string, never>> = {
  name: "echo",
  configSchema: z.object({}),
  stateSchema: z.object({ count: z.number() }),
  outboundMessageSchema: [],
  initialize: () => ({ count: 0 }),
  async step(_config, state) {
    console.log(`echo: got message, count=${state.count + 1}`);
    return { state: { count: state.count + 1 }, sendMessages: [] };
  },
};

const demoGraph = {
  id: "demo",
  nodes: [
    {
      id: "demo-echo",
      definitionName: echoNode.name,
      config: {},
      state: echoNode.initialize({}),
    },
  ],
  edges: [{ from: "demo-trigger", type: "trigger:webhook", to: ["demo-echo"] }],
  triggers: [
    {
      id: "demo-trigger",
      triggerName: "webhook",
      config: { host: "127.0.0.1", port: 8787, path: "/hook" },
    },
  ],
};

const store = new SqliteStore("data/arbetslag.db");

async function seedDemoGraph() {
  try {
    await store.get("graphs");
  } catch {
    // 存储里还没有图，种一份演示工作流
    await store.set("graphs", [demoGraph]);
  }
}

async function main() {
  const nodeDefinitionRepository = new InMemoryNodeDefinitionRepository();
  nodeDefinitionRepository.register(echoNode);
  const triggerRepository = new InMemoryTriggerRepository();
  const webhookTrigger = new WebhookTrigger();
  triggerRepository.register(webhookTrigger);

  await seedDemoGraph();
  await start({
    nodeDefinitionRepository,
    triggerRepository,
    store,
  });
  console.log("listening on http://127.0.0.1:8787/hook");

  const shutdown = async () => {
    await webhookTrigger.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
