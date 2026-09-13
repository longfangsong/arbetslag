# Backlog

## 虚拟群友（见 docs/prd/0001-virtual-group-member.md）

- **[deferred] 定时主动抛话（A2）**：bot 在没人触发时自己主动冒泡发言。本次不做。
  - 后续由**外部信息搜集系统**驱动（频率、时机由该系统决定）。
  - 上线前必须加频率上限，避免变成刷屏 bot。

## Compact

- **[done] stub 去掉 `result=<size>` 部分**
  - **问题**：`[omitted:tool] args=... result=48.2KB` 里的 size 目前不驱动任何明确决策——“发生过什么”已由工具名 + 参数完整传达，size 属于推测性有用，且每次请求都要为它付 token。
  - **改动**：stub 简化为 `[omitted:tool_name] args=...`；删除 `humanSize` 及 `MAX` 相关测试断言（compact.ts、compact.test.ts、loop.test.ts 中涉及 `result=` 的断言）。
  - **状态**：Actionable，改动小。
  - **重议条件**：若出现“重读大文件再次撑爆上下文”的真实案例，把 size（或更精确的信号）加回来。

- **[done] 摘要 prompt 支持 per-template 定制**
  - **问题**：`SUMMARY_SYSTEM_PROMPT` 目前写死在 `compact.ts`，不同 agent（不同语言习惯、不同摘要侧重）无法定制摘要行为。
  - **改动**：`Template` 加可选字段 `compactSummaryPrompt?: string`；`CompactDeps` 加 `summaryPrompt?`，orchestrator 从 template 透传；流水线里 `summaryPrompt ?? SUMMARY_SYSTEM_PROMPT`，现有常量退为默认值。与 `compactThreshold`/`compactRetainRounds` 同一模式，向后兼容。
  - **状态**：Actionable，改动小（三处，约 5 行）。

- **[done] SystemNotice 携带结构化数据，文案交给宿主应用**
  - **问题**：库现在把面向用户的文案烤死在字符串里（📦 emoji、中英文措辞、"~31.2K → ~4.1K tokens" 排版）——这些是宿主的本地化决定。`SystemNotice` 只有 `content: string`，库被迫既当数据又当文案，想定制的 app 无法改措辞。
  - **改动**：`SystemNotice` 加可选字段 `beforeTokens?` / `afterTokens?`（仅 `history_compacted` 时有值），通知生成处填充；`content` 保留为**默认文案**（90% 的 app 直接显示，零成本），想定制的 app 忽略 `content`、用自己的语言从字段渲染。两个 router 实现无需改动。文案生成点共两处：`formatCompactNotice`（compact.ts）与 `NOTHING_TO_COMPACT`（compact.ts），实施时一并明确其“默认渲染器”定位。
  - **状态**：Actionable，改动小。

- **[done] 摘要并入 `history[0]` system 条目（systemPrompt + summary 字符串拼接，单条 system 消息）**
  - 实际实施比原条目更简：不走独立 `agent.historySummary` 字段，直接 `history[0] = {role:"system", content: systemPrompt + "\n## History summary (compacted)\n" + 摘要}`；orchestrator 组请求改为直接发 `agent.history`（无 system 条目时 unshift 裸 systemPrompt）；滚动摘要从 `history[0]` 的 `## History summary` 标记下取出、显式喂给摘要 LLM 后整体替换。涉及 model.ts（无）、compact.ts、orchestrator.ts、两个测试文件、PRD/CONTEXT.md。

- **[done] 删掉 `lastPromptHistoryLength` 字段，从“最后一个 assistant entry”推导增量起点**
  - **问题**：`lastPromptTokens` 与 `lastPromptHistoryLength` 成对维护、持久化、失效。但每次 LLM 调用恰好追加一个 assistant entry（`handleAgentMessage` 压的是 user role，不会干扰），且 OpenAI 每次都返回 usage——所以“最后一个 assistant 的下标”在现实场景下恒等于存储的 cursor，该字段冗余。
  - **改动**：删 `Agent.lastPromptHistoryLength`（字段 + SerializedAgent 序列化）；`compactIfNeeded` 的锚点分支改为从尾部扫描最后一个 assistant entry 的下标 k，delta = `history.slice(k)`。注意差一：delta **包含**最后一条 assistant 本身（它没被 `prompt_tokens` 数过），是 `slice(k)` 不是 `slice(k+1)`。涉及 model.ts、orchestrator.ts、compact.test.ts/loop.test.ts 中设 `lastPromptHistoryLength` 的测试数据。
  - **已知边界**：某次调用未返回 `usage` 时（`usage?` 可选，接口弹性），锚点停在旧调用而最后 assistant 已前移，推导版会漏估旧 assistant 到它之间的内容——OpenAI 恒返回 usage，接受此边界。
  - **状态**：Actionable，改动小。

- **[done] 全库统一 Result 风格错误处理（框架层从 throw 迁移）**
  - **问题**：目前两层风格并存——工具层已是 `Result<T, string>`（17 个 tool），框架层（openai.ts、repository、router、compact.ts、orchestrator）全是 `throw new Error`。用户希望全库统一 Result。
  - **改动**：框架层函数返回 `Result<T, E>`；顶层（orchestrator dispatch / app 入口）作为唯一 throw/log 边界；工具层保持现状。涉及文件：`implementation/aiProvider/openai.ts`、`implementation/agent/*`、`implementation/template/*`、`implementation/outputRouter/telegram.ts`、`application/agent/compact.ts`（两个 throw）、`application/orchestrator.ts`，及全部相关测试。
  - **顺序依赖**：与上面几条 compact 改动有交叉（compact.ts 的 throw 会被改两次）——建议先做完 compact 相关条目再做本条，或本条实施时一并覆盖 compact.ts。
  - **状态**：已实施。定案：① 错误载体 `string`（与工具层一致）；② 直接用 neverthrow 的 `Result`，不新造类型，`src/index.ts` 导出 `Result` 供 app 用；③ 数据流路径全 Result 化——`AIProvider.complete` / `compactAgent` / `OutputRouter.route` / `TemplateRepository.default` 均返回 `Result<_, string>`，orchestrator 的 `dispatch`/`step`/`stepUntilIdle` 全链路传播错误；④ throw 只用作崩溃——配置错误（`TemplateRepository.default()` 的 "No templates found"、template 指向不存在的 provider）在 orchestrator 的 `unwrap()` helper 处 throw，运行时错误在 app 边界（telegram-bot `processChatBatch`）log + throw。
