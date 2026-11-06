import type { Trigger, Message, Context } from "@arbetslag/kernel";
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http";
import type { JsonValue } from "type-fest";
import z from "zod";
import type { Graph } from "@arbetslag/kernel";
import { newId } from "../../../kernel/src/utils";

export const configSchema = z.object({
  port: z.number(),
  host: z.string(),
  path: z.string(),
});

export type WebhookConfig = z.infer<typeof configSchema>;

export class WebhookTrigger implements Trigger<WebhookConfig> {
  name: string = "webhook";
  configSchema: z.ZodType<WebhookConfig> = configSchema;

  // host:port => {path => Graph}
  // todo: support prefix matching
  deliverTo: Map<string, Map<string, Graph>>;

  constructor() {
    this.deliverTo = new Map();
  }

  connect(workflow: Graph) {
    const clients = workflow.triggerSubscriptions.filter(client => client.triggerName === this.name);
    for (const client of clients) {
      const config = configSchema.parse(client.config);
      if (this.deliverTo.get(`${config.host}:${config.port}`) === undefined) {
        this.deliverTo.set(`${config.host}:${config.port}`, new Map());
      }
      let path = config.path;
      if (path[0] === '/') {
        // remove leading `/`
        path = path.slice(1);
      }
      this.deliverTo.get(`${config.host}:${config.port}`)!.set(config.path, workflow);
    }
  }

  start(context: Context) {
    for (const hostAndPort of this.deliverTo.keys()) {
      const [host, port] = hostAndPort.split(":", 2);
      createServer(async (req, res) => {
        const method = req.method;
        const url = req.url;
        const pathStartPosition = url!.indexOf(hostAndPort) + hostAndPort.length;
        // remove leading `/`
        const path = url?.slice(pathStartPosition).slice(1);
        const workflow = this.deliverTo.get(hostAndPort)?.get(path!);
        if (!workflow) {
          res.statusCode = 404;
          res.end("No workflow found!");
          return;
        }
        const headers = req.headers;
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        await workflow.stepUntilIdle(context, {
          id: newId(),
          from: workflow.triggerSubscriptions.find(it => {
            const clientConfig = configSchema.parse(it.config);
            return it.triggerName === this.name &&
              host === clientConfig.host &&
              parseInt(port!) === clientConfig.port &&
              path === clientConfig.path
          })!.id,
          type: `trigger:${this.name}`,

          method: method!,
          headers: headers as JsonValue,
          body
        });
        await context.store.set(workflow.id, workflow.serialize());
        res.end("ok");
      }).listen(port, parseInt(host!));
    }
  }
}
