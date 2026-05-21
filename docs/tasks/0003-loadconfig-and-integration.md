## Parent

- [0001-refactor-openai-provider-zero-arg](./0001-refactor-openai-provider-zero-arg.md)
- [0002-config-parser-schema-registry](./0002-config-parser-schema-registry.md)

## What to build

Implement `loadConfig(filePath)` in `src/infrastructure/config/load.ts` that:

1. Parses the file using the parser (extension-based)
2. Validates the parsed object against the Zod schema
3. Instantiates providers by resolving each string through the provider registry
4. Instantiates tools by resolving each string through the tool registry, populating a `ToolRepository`
5. Adds each template to a new `AgentTemplateRepository`
6. Returns `Partial<Config>` with `aiProviders`, `toolRepository`, `agentTemplateRepository`, and `config`

Export `loadConfig`, `registerProvider`, and `registerTool` from `src/index.ts`.

Write an integration test that creates a config file on disk (JSON), calls `loadConfig`, and verifies that providers, tools, and templates are correctly instantiated and populated.

## Acceptance criteria

- [ ] `loadConfig` parses and validates a config file end-to-end
- [ ] `loadConfig` returns `Partial<Config>` with correctly populated providers, tools, and templates
- [ ] `loadConfig` throws on unknown provider type
- [ ] `loadConfig` throws on unknown tool type
- [ ] `loadConfig` throws on schema validation failure
- [ ] `loadConfig` handles empty/minimal config (all fields optional)
- [ ] `loadConfig`, `registerProvider`, and `registerTool` are exported from `src/index.ts`
- [ ] Integration test loads a real config file and verifies all three entity types
- [ ] `pnpm test` passes
- [ ] `pnpm type-check` passes

## Blocked by

- [0001-refactor-openai-provider-zero-arg](./0001-refactor-openai-provider-zero-arg.md)
- [0002-config-parser-schema-registry](./0002-config-parser-schema-registry.md)
