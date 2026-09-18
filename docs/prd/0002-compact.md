# 0002 — Agent 历史压缩（Compact）

> 状态：Spec（需求已锁定）
> 关联：`packages/arbetslag` 框架核心，作用于 `Agent.history`

## Problem Statement

`Agent` 的消息历史（`history`）只增不减。随着对话变长，历史中的大量工具调用 I/O
（`read_file` 返回的整份文件内容、`fetch_web_page` 抓回的整页文本、大参数）占据了
context window 的大部。用户观察到的核心痛点是：**历史过长时模型注意力被稀释，
"忘记" system prompt 中的指令与人设**，回复质量随对话变长持续下降。

当前框架没有任何机制控制单个 Agent 历史的增长——唯一的"压缩"方式是销毁 Agent
重建上下文，这会丢失全部对话记忆。

## Solution

为框架引入两级历史压缩（compact），在保持"最近 X 轮原文不动"的前提下，把超出
水位线的旧历史逐步压缩，使 Agent 历史总量稳定在模板配置的阈值以下：

1. **级别 1 — 规则级压缩**（零成本、确定性）：
   只处理水位线以下的工具调用条目——砍掉大块的工具输入参数和工具结果内容，
   每处替换为一行简短 stub（保留工具名、参数概要、被省略的大致体积），
   让模型知道"这里发生过什么"。assistant 文本回复和 user 消息一律不动。

2. **级别 2 — LLM 级压缩**（规则级不够时升级）：
   规则级压完后重新计量，若历史总量仍 ≥ 阈值，则用该 Agent 模板配置的
   **同一个 AI Provider 和 model** 把水位线以下的整段历史（含已 stub 的条目）
   总结成一段摘要文本。摘要**替换**掉水位线以下的所有条目，并拼接在
   system prompt **下面**（作为 system 区的一部分，紧跟 system prompt 之后）。

最终形态：`系统区（system prompt + 至多一段滚动摘要）+ 最近 X 轮原文`，
总量在阈值以下。

触发方式两种，共用同一压缩流程：

- **自动**：每次向 AI Provider 发起 completion 之前检测历史 token 量，
  ≥ 模板阈值即执行；
- **手动**：用户（通过 Input Adopter 适配的渠道，如 Telegram 命令）显式发起，
  无视阈值立即执行。

阈值和"保留轮数 X"均为 **Template 级配置**（每个模板可配不同值，给合理默认值）。

## User Stories

### 自动触发

1. As a framework user, I want compaction to trigger automatically when an agent's history exceeds the template's token threshold, so that I never have to think about context size.
2. As a framework user, I want the threshold to be configurable per Template, so that a chatty support agent and a terse cron agent can have different budgets.
3. As a framework user, I want sensible default values for the threshold and retained-round count, so that a template without explicit config still gets compaction protection.
4. As a framework user, I want compaction to run before the LLM completion request is sent, so that the request the provider receives is always within budget.
5. As a framework user, I want the retained-round count (最近 X 轮) to also be configurable per Template, so that I can trade off recency fidelity against history size.
6. As a framework user, I want the last X rounds to remain completely untouched by any compaction level, so that the model keeps full fidelity on the most recent context it is actively relying on.

### 级别 1 — 规则级压缩

7. As a framework user, I want rule-level compaction to strip only bulky tool-call inputs and tool results below the waterline, so that the deterministic pass is safe and never rewrites the conversation itself.
8. As a framework user, I want each stripped tool I/O to be replaced by a one-line stub naming the tool, a gist of its arguments, and the omitted size, so that the model still knows what happened there.
9. As a framework user, I want assistant text messages and user messages to be left completely intact by rule-level compaction, so that the actual conversation is never degraded by rules.
10. As a framework user, I want rule-level compaction to be idempotent — already-stubbed entries are never re-processed, so that repeated compaction passes are stable and cheap.
11. As a framework user, I want rule-level compaction to require no AI Provider call, so that the first tier is free, instant, and works even with a down LLM.

### 级别 2 — LLM 级压缩

12. As a framework user, I want LLM-level compaction to trigger when rule-level compaction alone cannot bring the history below the threshold, so that escalation is driven by a single measurable criterion (re-measured token count vs. threshold).
13. As a framework user, I want LLM-level compaction to use the same AI Provider and model configured on the agent's Template, so that no extra configuration surface is introduced.
14. As a framework user, I want the LLM-level summary to replace all history entries below the waterline, so that the compacted agent's final shape is always "system area + last X rounds".
15. As a framework user, I want the summary to be placed directly below the system prompt (as part of the system area, right after the system prompt), so that the model reads it as authoritative background rather than as a user utterance.
16. As a framework user, I want the summary to be rolling — on a later compaction, the previous summary plus newly-aged rounds are re-summarized into one new summary, so that there is never more than one summary and it never grows stale.
17. As a framework user, I want the summary to preserve the conversation's key facts (decisions made, files touched, user preferences stated, unresolved threads) rather than a verbatim transcript, so that long-range context survives compression.
18. As a framework user, I want the summary to be persisted in the agent's serialized State, so that after a checkpoint/restore cycle the compacted history and its summary survive intact.
19. As a framework user, I want LLM-level compaction failure (provider error) to fail fast and crash the processing cycle, consistent with the framework's error-handling policy, so that state is checkpointed and the host decides recovery.

### 手动触发

20. As a chat user, I want to explicitly request a compaction (e.g. via a chat command adapted by the Input Adopter), so that I can reclaim context at a moment I consider a good boundary.
21. As a chat user, I want manual compaction to ignore the threshold and run the full pipeline (rule-level first, escalate to LLM-level if still over), so that I get the same guaranteed end state as automatic compaction.
22. As a chat user, I want manual and automatic compaction to share one code path, so that their behavior is identical except for the trigger source.
23. As a chat user, I want feedback after a manual compaction (e.g. how much was reduced), so that I know the command took effect.

### 状态与一致性

24. As a framework user, I want compaction to modify the Agent's history in place (within State), so that it is naturally covered by the existing automatic checkpointing after each step.
25. As a framework user, I want compaction to respect entry pairing — a compaction boundary never splits an assistant message with tool_calls from its tool results — so that the provider never receives an invalid message sequence.
26. As a framework user, I want compaction to be a transparent, framework-internal behavior (not an agent-invokable Tool), so that the agent's own tool list stays focused on its real job.

## Testing Plans

- **规则级压缩正确性**：给定包含长工具参数、长工具结果、assistant 文本、user 消息的混合历史，压缩后工具 I/O 被替换为 stub（含工具名与省略体积），assistant/user 文本逐字不变。
- **水位线行为**：最近 X 轮（含其中的工具 I/O）在任何压缩级别下保持原样；X 的边界以"轮"为单位，且不会把 assistant(tool_calls) 与其 tool 结果拆到水位线两侧。
- **幂等性**：对已压缩历史重复执行规则级压缩，stub 条目不再变化，结果稳定。
- **升级判据**：构造"规则级压完仍 ≥ 阈值"与"压完 < 阈值"两组历史，验证前者升级 LLM 级、后者停止。
- **LLM 级压缩**：用 in-memory/mocked AI Provider 验证——水位线以下条目被摘要替换、摘要紧跟 system prompt、摘要只有一段；再次压缩时旧摘要参与滚动再总结。
- **失败处理**：LLM 总结调用抛错时，处理循环 fail fast 且状态已 checkpoint、可恢复。
- **手动触发**：手动命令无视阈值立即执行完整流程，且与自动触发走同一代码路径；用户收到执行反馈。
- **模板配置**：阈值与保留轮数按模板生效，未配置时使用默认值。
- **持久化**：压缩后的 Agent 经 serialize → deserialize 往返，历史与摘要完整保留。

## Out of Scope

- **压缩专用便宜模型配置**：LLM 级压缩固定使用模板自身的 model；"模板单独配一个更便宜的压缩模型"留到真实需求出现时再做。
- **token 精确计量**：阈值检测采用轻量估算（如字符数 ÷ 系数）而非引入 tokenizer 依赖；精确度留到估算被证明不够时再升级。
- **摘要的结构化 schema**（如强制 JSON 的"decisions / files / open threads"分区）：摘要为自由文本，结构化留到观察到模型丢关键事实时再考虑。
- **跨 Agent / 跨 Chat 的记忆共享**（如 MEMORY.md 全局记忆）：compact 只解决单个 Agent 历史的膨胀，长期记忆是独立特性。
- **provider 硬 token 上限的自动适配**（按每个 provider 的真实窗口动态计算阈值）：阈值由模板显式配置，框架不按 provider 元数据推算。
- **压缩历史的 UI 展示 / 回放**：压缩是框架内部行为，不做面向用户的历史浏览。

## Implementation Decisions（grill 后锁定）

### 代码落点与挂点

- 新建纯函数模块 `application/agent/compact.ts`：token 估算、轮切分与水位线、规则级压缩、待总结历史序列化、总结 prompt。压缩逻辑不进 Agent 类（Agent 拿不到 provider，保持其"处理单个事件"职责）。
- 唯一挂点：orchestrator 的 `llm_completion_request` handler，在调 `aiProvider.complete()` 前执行流水线。压缩后对 agent `save()`，并发送压缩后的 `agent.history`（事件里的 `history` 是推送时刻的快照，不可再用）。
- LLM 级总结由 orchestrator 调用：`aiProvider.complete(template.model, [总结指令(system), 待总结历史(user)], [])`，无工具、无 outputSchema；调用返回的 usage 丢弃（不锚定）。

### 配置与默认值

- `Template` 新增可选字段：`compactThreshold?: number`（默认 **32768**）、`compactRetainRounds?: number`（默认 **4**）。未配置即用默认，所有模板天然受保护。
- 阈值计量**包含 system prompt**。

### 计量（详见 `docs/adr/0001-compact-token-metering.md`）

- `CompletionResult` 新增 `usage?: { prompt_tokens: number }`；OpenAIProvider 从 `response.usage` 填，inMemory 不填。
- Agent 新增持久化锚点字段 `lastPromptTokens?: number`，在 `handleLLMCompletionResponse` 用 usage 更新；增量起点从“最后一个 assistant entry”下标推导（不另存字段：每次 LLM 调用恰好追加一个 assistant entry，agent 消息存为 user role 不会干扰）。
- 检测公式：有锚点 → `lastPromptTokens + estimate(最后一条 assistant 及其后条目)`；无锚点 → `estimate(systemPrompt + 整段 history)`。
- 任何压缩后锚点置空，下一轮走纯估算，等下次 LLM 响应重新锚定。
- 规则级后复检用 `estimate(systemPrompt + 压缩后整段 history)`，仍 ≥ 阈值 → 升级 LLM 级。
- 估算公式：CJK 字符 × 1 + 其他字符 ÷ 4（向上取整）。

### 轮与水位线

- 轮 = 一条 user 形态条目（user / agent_message / api_callback）+ 其引发的全部 assistant / tool 条目，至下一条 user 形态条目前。保留最近 X 轮以轮为单位。
- 水位线必落在轮边界，结构性保证 assistant(tool_calls) 与其 tool 结果不被拆散。
- 边界情况：最近 X 轮自身就超阈值时，接受溢出，打 warning 日志，照常发送。

### 规则级格式（定死，兼作幂等检测）

- tool 条目 content 替换为：`[omitted:read_file] args={"path":"a.ts"}`；幂等检测 = `content.startsWith("[omitted:")`，不加 entry 字段。
- assistant `tool_calls` 中：长字符串参数值截断至 100 字符 + `…(N more chars)`；args 序列化超 100 字符同样截断。

### LLM 级摘要

- **`history[0]` 恒为 system 条目**：`content = composeSystemPrompt(template)`（即 `template.systemPrompt + 框架 meta prompt`；若已有摘要：再 `+ "\n## History summary (compacted)\n" + 摘要`）。`Agent.create`、LLM 级压缩、`deserialize` 对存量 agent 的 backfill 都走同一个 `composeSystemPrompt`，meta prompt 压缩后不丢失、存量 agent 加载即修复（无持久化迁移）；orchestrator 组请求直接发 `agent.history`（无额外拼接）。滚动摘要 = 从 `history[0]` 的 `## History summary (compacted)` 标记下取出旧摘要，显式喂给摘要 LLM 后整体替换。不新增 `HistoryEntry` 变体。
- 待总结历史序列化：每条一行，`[user] …` / `[assistant] …` / `[tool read_file] …`（此时工具 I/O 已是 stub）。
- 总结 prompt 为 compact.ts 内固定英文文本：说明这是进行中的 agent 对话的压缩历史、stub 含义；要求保留用户请求与偏好、关键决策、文件/外部资源事实、未了事项状态；丢弃过程细节与原文引用；跟随对话语言，分节，尽可能短。

### 用户感知（自动/手动统一）

- 自动 compact 发生时**通知用户**：一条一行式系统通知，先于 agent 本次回复到达（压缩在 completion 之前，天然顺序 = 通知 → 回复）。每次压缩都通知，不限流（触发频率天然低：压完要再涨过整个阈值区间才会二次触发）。
- 手动/自动共用同一条通知文案，由**框架格式化完整文本**：`📦 Compacted history: ~31.2K → ~4.1K tokens`；手动触发但无可压缩内容时：`📦 Nothing to compact`。
- LLM 自身不额外注入"刚被压缩过"的提示——`history[0]` system 条目内的摘要已足以让模型知道历史被压缩过。

### 手动触发

- 新事件 `compact_request { id, event_type, chat_id }`，host（如 telegram-bot 识别 `/compact`）推它代替 `message`；orchestrator 用 `getByChatId` 解析 agent，跑同一条流水线 + `save()` + 发通知。
- chat 无 agent 时：no-op + "无可压缩内容"通知，不创建 agent。

### 通知的通道（Compacted）

- 新增 `Compacted` 类型：`{ kind: "history_compacted"; beforeTokens?; afterTokens? }`（agent-scoped：token 数属于被压缩的那个 agent，由 orchestrator 代发；早期草案曾带 `content: string`，后改为结构化字段、文案由 router 渲染）。`OutputRouter.route` 签名改为 `route(event: AgentOutput | Compacted)`，两个现有实现（框架 `Telegram`、app `SmartTelegramRouter`）各加一个分支，渲染上可区别于 agent 发言（如斜体）。
- 语义区分：AgentOutput = agent（LLM）的发言；Compacted = 某 agent 的 history 被压缩这一事实，由框架运行时告知用户。不塞进 AgentOutput，避免 app 层退化为字符串匹配前缀。
- **不上 bus**：orchestrator 即生产者且已持有 `outputRouter`，直接调用；通知是 cosmetic 副作用，与现有 `agent_output` 路由一样不参与 checkpoint 回放。因此不需要 id / from_agent_id。
- `kind` 保留为 union 内部的稳定判别位，为后续通知种类留缝（现在只有 `history_compacted` 一种）。

### 与 app 层既有机制的关系

- telegram-bot 的 4 小时 idle 全清（`agent.history = []`）保留不动，与 compact 共存；重叠时 idle 全清自然胜出（连摘要一起清）。

## Further Notes

- 当前 `Agent.history` 不含 system 消息——system prompt 由 orchestrator 在处理
  `llm_completion_request` 时临时拼在最前面。摘要应作为持久化在 Agent 历史中的
  独立条目（system 区内容），由 orchestrator 拼在 system prompt 之后，从而满足
  "紧跟 system prompt"的定位且天然随 State checkpoint 持久化。
- 摘要不新增 `HistoryEntry` 变体，直接用普通 `{ role: "system" }` 条目（见 Implementation Decisions「LLM 级摘要」）。
- "轮"的定义与保留机制见 Implementation Decisions「轮与水位线」；stub 与摘要的具体措辞已在那里定死，此处不再重复。
- 手动触发在 `apps/telegram-bot` 中的具体命令形态（如 `/compact`）由 app 层
  Input Adopter 决定，框架只要求"存在一条不经过 LLM 的用户指令通道能触发
  压缩"这一能力。
