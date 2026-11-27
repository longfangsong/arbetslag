import type { Context, Graph, Message, Trigger } from "@arbetslag/kernel";
import { deliver, newId } from "@arbetslag/kernel";
import { createServer, type Server } from "node:http";
import type { JsonValue } from "type-fest";
import z from "zod";

export const configSchema = z.object({
  port: z.number(),
  host: z.string(),
  path: z.string(),
});

export type WebhookConfig = z.infer<typeof configSchema>;

type Route = {
  graph: Graph;
  // 触发这条路由的 TriggerSubscription，投递时作为消息的 `from`
  subscriptionId: string;
};

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "");
}

function splitHostAndPort(hostAndPort: string): [string, number] {
  const separator = hostAndPort.lastIndexOf(":");
  return [
    hostAndPort.slice(0, separator),
    Number.parseInt(hostAndPort.slice(separator + 1), 10),
  ];
}

export class WebhookTrigger implements Trigger<WebhookConfig> {
  name = "webhook";
  configSchema: z.ZodType<WebhookConfig> = configSchema;

  // host:port => { normalized path => route }
  // todo: support prefix matching
  private routes = new Map<string, Map<string, Route>>();
  private servers: Array<Server> = [];

  connect(graph: Graph) {
    for (const subscription of graph.triggerSubscriptions) {
      if (subscription.triggerName !== this.name) {
        continue;
      }
      const config = configSchema.parse(subscription.config);
      const hostAndPort = `${config.host}:${config.port}`;
      let routes = this.routes.get(hostAndPort);
      if (routes === undefined) {
        routes = new Map();
        this.routes.set(hostAndPort, routes);
      }
      routes.set(normalizePath(config.path), {
        graph,
        subscriptionId: subscription.id,
      });
    }
  }

  start(context: Context) {
    for (const [hostAndPort, routes] of this.routes) {
      const [host, port] = splitHostAndPort(hostAndPort);
      const server = createServer(async (req, res) => {
        try {
          const path = normalizePath((req.url ?? "/").split("?")[0] ?? "");
          const route = routes.get(path);
          if (route === undefined) {
            res.statusCode = 404;
            res.end("No workflow found!");
            return;
          }
          const chunks: Array<Buffer> = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const message: Message = {
            id: newId(),
            from: route.subscriptionId,
            type: `trigger:${this.name}`,
            method: req.method ?? "GET",
            headers: Object.fromEntries(
              Object.entries(req.headers).filter(
                (entry): entry is [string, string | Array<string>] =>
                  entry[1] !== undefined,
              ),
            ) as JsonValue,
            body: Buffer.concat(chunks).toString(),
          };
          await deliver(context, route.graph, message);
          res.end("ok");
        } catch (error) {
          res.statusCode = 500;
          res.end(error instanceof Error ? error.message : String(error));
        }
      });
      server.on("error", (error) => {
        console.error(`webhook ${hostAndPort} failed:`, error);
      });
      server.listen(port, host);
      this.servers.push(server);
    }
  }

  async stop() {
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    this.servers = [];
  }
}
