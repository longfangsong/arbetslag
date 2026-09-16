# Logging: `debug` in the library, console wrappers in the app

The framework (`arbetslag`) and its host apps log differently on purpose.

**Library side** uses the [`debug`](https://www.npmjs.com/package/debug) package
with `arbetslag:<area>` namespaces (`output`, `input`, `compact`, `orchestrator`,
`tool`). `debug` is **silent by default** and only emits when the host sets the
`DEBUG` environment variable (e.g. `DEBUG=arbetslag:*`). A published framework
must not print to the console uninvited — every consumer runs it, most never
want its trace output. `debug(ns)` is cached per namespace, so call sites just
invoke it with no per-call cost. Namespaces:

- `arbetslag:output` — OutputRouter (send attempts, success/failure)
- `arbetslag:input` — InputAdopter (external fetch failures)
- `arbetslag:compact` — history compaction overflow warnings
- `arbetslag:orchestrator` — event dispatch, config errors, loop limits
- `arbetslag:tool` — central per-invocation trace in the orchestrator, plus
  internal milestones for the one multi-step tool (`create_cron`)

**Application side** (e.g. `telegram-bot`) uses a thin `logger.ts` module that
forwards to `console.log` / `console.warn` / `console.error`. A host program
*owns* its console output — startup banners, webhook status, routing trace — so
there is no reason to hide it behind a flag. The module is a single indirection
so the app has one place to change log behaviour later.

The two layers meet cleanly on the `DEBUG` variable: the host can turn on
framework tracing without the framework gaining any logging API of its own.

Why not one approach for both: a shared `console`-based logger would make the
library spam every consumer; a `debug`-based logger would make the app hide its
startup output behind an env var it never sets. The split matches who owns the
output.

Revisit when: the app grows enough real logging to want levels, prefixes, or
structured (JSON) output — then promote `logger.ts` past a three-function
forwarder. If the library starts shipping a telemetry or health feature that
should be visible without `DEBUG`, reconsider whether that path stays in
`debug`.
