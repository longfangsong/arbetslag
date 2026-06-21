# Arbeitslag — AI Agent Framework

**arbetslag** (Swedish: "work team") is a TypeScript framework for building tool-using AI agents with sub-agent delegation.

## Development Principle

### YAGNI

Do not over design things. Do not design for something that "will be useful in the future".

When a simple function can do the job, don't create a class.

Do not create abstraction of things until there are multiple (>=3) instance of things that fits in the abstraction.

Do not extract separated interface/class from another interface/class unless the original interface/class has more than 10 fields or there is a really good reason for the new interface/class to exist.

## Ubiquitous language

Please always use the terms listed in ./CONTEXT.md when talking with the user.

## Build & Development

```bash
pnpm install

pnpm build          # Build with tsdown (ESM + CJS, with .d.ts)
pnpm dev            # Watch mode
pnpm test           # Vitest
pnpm lint           # Biome lint (auto-fix)
pnpm format         # Biome format
pnpm type-check     # TypeScript type checking
```

**Tooling:** tsdown (bundler), Biome (lint/format), Vitest (tests), Zod v4 (schemas), TypeScript 6

## Migration progress

`_src` is old source code. Do not look at it.
