# Arbeitslag — AI Agent Framework

**arbetslag** (Swedish: "work team") is a TypeScript framework for building tool-using AI agents with sub-agent delegation.

## Development Principle

### YAGNI

Do not over design things. Do not design for something that "will be useful in the future".

When a simple function can do the job, don't create a class.

Do not create abstraction of things until there are multiple (>=3) instance of things that fits in the abstraction.

Do not extract separated interface/class from another interface/class unless the original interface/class has more than 10 fields or there is a really good reason for the new interface/class to exist.

Try not to create new concepts just for naming things, always prefer using existing concepts.

## Ubiquitous language

Please always use the terms listed in ./CONTEXT.md when talking with the user.

## Workspace

```text
packages/arbetslag   # the framework library (published to npm)
apps/telegram-bot    # a consumer app that imports the `arbetslag` package
```

## Debug Strategy

DO NOT think about how the program runs. Add log, run it and TRACE it instead.

## Tool Naming

A tool name is `snake_case` verb-first, such that `Agent <ToolName> <parameter>` reads as one complete sentence in subject-verb-object order.

- ✅ `read_file` → "agent read file a.txt"
- ✅ `create_cron` → "agent create cron 0 9 * * 1 周一提醒 ..."
- ❌ `file_read` / `cron_create` (noun before verb)

When adding a tool, check that the sentence reads naturally; prefer an ordinary verb (read, get, list, create, update, delete, send) as the first word.
