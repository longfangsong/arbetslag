import { describe, it, expect, beforeEach } from "vitest";
import { FileSystemTemplateRepository } from "./repository";
import { InMemoryFileSystem } from "@/implementation/tool/file/filesystem/inMemory";
import { Template } from "@/application/agent/template/model";

describe("FileSystemTemplateRepository", () => {
  let fs: InMemoryFileSystem;
  let repo: FileSystemTemplateRepository;

  const sampleTemplate: Template = {
    name: "test",
    description: "A test template",
    ai_provider: "openai",
    model: "gpt-4",
    systemPrompt: "You are a test agent.",
    allowedTools: [],
  };

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    repo = new FileSystemTemplateRepository(fs, "templates");
  });

  it("adds and retrieves a template by name", async () => {
    await repo.add(sampleTemplate);
    const result = await repo.getByName("test");
    expect(result).toEqual(sampleTemplate);
  });

  it("returns null for non-existent template", async () => {
    const result = await repo.getByName("nonexistent");
    expect(result).toBeNull();
  });

  it("lists all added templates", async () => {
    await repo.add(sampleTemplate);
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(sampleTemplate);
  });

  it("returns empty list when no templates exist", async () => {
    const list = await repo.list();
    expect(list).toHaveLength(0);
  });

  it("returns the first template as default", async () => {
    await repo.add(sampleTemplate);
    const result = await repo.default();
    expect(result).toEqual(sampleTemplate);
  });

  it("throws when no templates exist for default", async () => {
    await expect(repo.default()).rejects.toThrow("No templates found");
  });

  it("stores multiple templates and lists them all", async () => {
    const template2: Template = {
      name: "test2",
      description: "Another template",
      ai_provider: "openai",
      model: "gpt-3.5",
      systemPrompt: "You are another agent.",
      allowedTools: [],
    };
    await repo.add(sampleTemplate);
    await repo.add(template2);
    const list = await repo.list();
    expect(list).toHaveLength(2);
  });
});
