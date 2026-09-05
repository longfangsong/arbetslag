import { Repository } from "@/application/tool/repository";
import { Tool } from "@/application/tool/model";

export class InMemoryToolRepository implements Repository {
  private readonly registry = new Map<
    string,
    Tool<unknown, unknown, unknown>
  >();

  constructor(tools: Array<Tool<unknown, unknown, unknown>> = []) {
    for (const tool of tools) {
      this.registry.set(tool.name, tool);
    }
  }

  async add(tool: Tool<unknown, unknown, unknown>): Promise<void> {
    this.registry.set(tool.name, tool);
  }

  async getByName(
    name: string,
  ): Promise<Tool<unknown, unknown, unknown> | null> {
    return this.registry.get(name) ?? null;
  }

  getByNames(names: string[]): Array<Tool<unknown, unknown, unknown>> {
    return names
      .map((n) => this.registry.get(n))
      .filter((t): t is Tool<unknown, unknown, unknown> => t !== undefined);
  }

  get tools(): Array<Tool<unknown, unknown, unknown>> {
    return Array.from(this.registry.values());
  }
}
