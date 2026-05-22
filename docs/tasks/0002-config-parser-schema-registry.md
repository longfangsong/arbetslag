## What to build

Build the infrastructure for parsing and validating config files:

- **Parser** (`src/infrastructure/config/parser.ts`) — reads a file and parses it based on extension: `.json` (built-in `JSON.parse`), `.yaml`/`.yml` (`yaml` package), `.toml` (`@iarna/toml` package). Throws on unknown extension or missing file.
- **Schema** (`src/infrastructure/config/schema.ts`) — Zod schema that validates the parsed object. Four optional top-level keys: `providers` (array of strings), `tools` (array of strings), `templates` (array of Template objects matching existing `Template` interface), `config` (record of string to any).

Add `yaml` and `@iarna/toml` as dependencies.

## Acceptance criteria

- [ ] `parser.ts` correctly parses `.json`, `.yaml`, `.yml`, and `.toml` files
- [ ] `parser.ts` throws on unknown file extension
- [ ] `parser.ts` throws on missing file
- [ ] `schema.ts` validates correct config objects and rejects invalid ones

- [ ] `yaml` and `@iarna/toml` are added as dependencies
- [ ] `pnpm type-check` passes
- [ ] Tests cover parser (all formats + error cases) and schema validation

## Blocked by

None - can start immediately.
