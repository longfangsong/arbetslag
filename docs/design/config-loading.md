# Design: Load Templates, AI Providers, and Tools from Config Files

## Problem

Templates, AI providers, and tools are currently hardcoded in the host program. Users want to declare them in config files instead.

## Solution

Provide `loadConfig(filePath)` that reads a config file (JSON, TOML, or YAML) and returns the parts of `Config` that can be declared statically: AI providers, tools, and templates.

Format is auto-detected by file extension: `.json`, `.toml`, `.yaml`/`.yml`.

## Decisions

| #   | Decision                   | Choice                      | Rationale                                                                  |
| --- | -------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| 1   | Custom modules             | `type` can be a module path | Registry lookup first, then `import()`. No new config keys.                |
| 2   | Tools format               | Array of strings            | Simple. Args from `config` section or `process.env`.                       |
| 3   | Provider format            | Array of strings            | Type string = provider name. Objects later if multiple instances needed.   |
| 4   | Constructor args           | None                        | Secrets from `process.env`, non-secrets from `config` section at runtime.  |
| 5   | `config` section           | Keep                        | Non-secret settings (timeouts, feature flags, etc.).                       |
| 6   | Return type                | `Partial<Config>`           | Host spreads + fills in `fileSystem`, `outputHandlerRegistry`.             |
| 7   | `AIProvider` interface     | No change                   | Providers read secrets from `process.env` in zero-arg constructor.         |
| 8   | File I/O                   | `loadConfig` reads file     | Node.js framework. `FileSystem` abstraction is for runtime, not bootstrap. |
| 9   | Cross-reference validation | None at load time           | Runtime already fails clearly. Don't over-engineer.                        |
| 10  | Multiple config files      | Single file only            | Composition is the host's responsibility.                                  |

## Config File Structure

```jsonc
{
  "providers": ["openai"],
  "tools": ["getTime", "httpRequest", "sendTelegramMessage"],
  "templates": [
    {
      "name": "default",
      "description": "General-purpose assistant",
      "ai_provider": "openai",
      "model": "gpt-4o",
      "systemPrompt": "You are a helpful assistant.",
      "allowedTools": ["getTime", "httpRequest", "sendTelegramMessage"],
    },
  ],
  "config": {
    "telegram_bot_token": "123:ABC",
  },
}
```

All four top-level keys are optional. A config file may declare any combination.

## Architecture

### 1. Registry (`src/infrastructure/config/registry.ts`)

Global maps that resolve `type` strings to constructors. The framework pre-registers its built-in providers and tools. Users can register their own.

```typescript
const providerRegistry = new Map<string, new () => AIProvider>();
const toolRegistry = new Map<string, new () => Tool<any, any, any>>();

export function registerProvider(type: string, cls: new () => AIProvider): void;
export function registerTool(
  type: string,
  cls: new () => Tool<any, any, any>,
): void;
```

Built-in registrations (auto-registered at module load):

- Provider: `"openai"` → `OpenAIProvider`
- Tools: `"getTime"` → `GetTime`, `"httpRequest"` → `HttpRequest`, `"sendTelegramMessage"` → `SendTelegramMessage`, `"listTemplates"` → `ListTemplates`, `"spawn"` → `Spawn`

**Future:** When `type` is not found in registry, treat it as a module path and `import()` it. The module should default-export the constructor.

### 2. Parser (`src/infrastructure/config/parser.ts`)

Reads a file and parses it based on extension. Returns a plain object.

- `.json` → `JSON.parse` (built-in)
- `.yaml` / `.yml` → `yaml.parse` (npm: `yaml`)
- `.toml` → `TOML.parse` (npm: `@iarna/toml`)

Throws if extension is unrecognized or file not found.

### 3. Schema (`src/infrastructure/config/schema.ts`)

Zod schema that validates the parsed object:

```typescript
const arbeitslagConfigSchema = z.object({
  providers: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  templates: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        ai_provider: z.string(),
        model: z.string(),
        systemPrompt: z.string(),
        allowedTools: z.array(z.string()),
      }),
    )
    .optional(),
  config: z.record(z.string(), z.any()).optional(),
});
```

### 4. Loader (`src/infrastructure/config/load.ts`)

```typescript
export async function loadConfig(filePath: string): Promise<Partial<Config>> {
  const raw = parseFile(filePath);
  const parsed = arbeitslagConfigSchema.parse(raw);

  const aiProviders = (parsed.providers ?? []).map((type) => {
    const Ctor = providerRegistry.get(type);
    if (!Ctor) throw new Error(`Unknown provider type: ${type}`);
    return new Ctor();
  });

  const toolRepository = new ToolRepository();
  (parsed.tools ?? []).forEach((type) => {
    const Ctor = toolRegistry.get(type);
    if (!Ctor) throw new Error(`Unknown tool type: ${type}`);
    toolRepository.tools.push(new Ctor());
  });

  const agentTemplateRepository = new AgentTemplateRepository();
  for (const template of parsed.templates ?? []) {
    await agentTemplateRepository.add(template);
  }

  return {
    aiProviders,
    toolRepository,
    agentTemplateRepository,
    config: parsed.config ?? {},
  };
}
```

### 5. Constructor Contract

Providers and tools use **zero-argument constructors**. They read what they need at runtime:

- **Secrets** (API keys, tokens) → `process.env`
- **Non-secret config** → `ToolExecutionContext.config` (for tools) or `Config.config` (for providers via the orchestrator)

Existing constructors that accept options must be refactored:

- `OpenAIProvider({ apiKey, baseUrl, name })` → `OpenAIProvider()` — reads `OPENAI_API_KEY` and `OPENAI_BASE_URL` from `process.env`
- `SendTelegramMessage({ token })` → `SendTelegramMessage()` — reads `config.telegram_bot_token` from `ToolExecutionContext` at call time

Tools with no-arg constructors (`GetTime`, `HttpRequest`, `ListTemplates`, `Spawn`) need no changes.

### 6. Exports (`src/index.ts`)

```typescript
export { loadConfig } from "@/infrastructure/config/load";
export {
  registerProvider,
  registerTool,
} from "@/infrastructure/config/registry";
```

## What's NOT in Config

- `fileSystem` — infrastructure decision, host-controlled
- `outputHandlerRegistry` — registered per-chat dynamically by the host
- `State` (agents, chats, events) — persisted/restored via existing serialization

## Dependencies

- `yaml` — YAML parser
- `@iarna/toml` — TOML parser

## Usage Example

```typescript
import {
  loadConfig,
  InMemoryFileSystem,
  OutputHandlerRegistry,
  type Config,
} from "arbetslag";

const loaded = await loadConfig("./arbetslag.json");

const config: Config = {
  ...loaded,
  fileSystem: new InMemoryFileSystem(),
  outputHandlerRegistry: new OutputHandlerRegistry(),
};
```

## Error Handling

Fail fast. Any error during loading aborts the entire operation.

- File not found → `Error: Config file not found: ./arbetslag.json`
- Unknown file extension → `Error: Unsupported config format: .xyz`
- Unknown provider/tool type → `Error: Unknown provider type: foo`
- Schema validation failure → Zod error with path to invalid field
