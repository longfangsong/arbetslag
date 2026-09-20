# Backlog

## Sub-agent（见 docs/prd/0003-sub-agent.md）

- **[deferred] Sub-agent 与外界通信的工具**：本次它的唯一对外通道是它的 Creator。后续由工具实现（哪个渠道、以谁的名义发言待定）。
- **[待定] 每个 Agent 的 OutputRouter 是否真的做成队列**：已按「每个 Agent 有一个 router」实现（orchestrator 收到 `agent_output` → 解析该 Agent 的 router → 有 Creator 的是 ReportRouter，回答 Creator 里点名该 Agent 的 open wait；没有 Creator 的走 app 的 router），但 router 仍是**无状态的路由决策**，不是队列：
  - Report 的唯一状态在 Agent 历史里，router 只是「这次输出该给谁」；所以 `wait_for_agent` 的拉取仍是 `reportOf(agent)`（读该 Agent 的输出），不是消费。
  - 因此第二个 Wait 对同一 Agent 会重读同一个最新 Report（当前语义：Report 可读，不被消费）。
  - 改成真队列的条件（出现任一条再改）：(1) 需要消费语义（pull 之后不可再读，或同一 Agent 的多个输出要按序排队）；(2) router 需要持久化（跨重启的 pending，见 task 0007）。那时 `OutputRouter` 要加 `pull`，并需定：消费还是可读、持久化在哪、app 侧（无法 pull 的 adapter）怎么表达。
  - 前提：`route` 不返回事件（只有需要代 agent 回答 open wait 的 ReportRouter 持有 bus 引用直接写事件，其他 router 仍只是送达渠道）；空内容的 turn 也会被路由（`agent_output` 的发射条件已放宽，router 各自决定要不要发）。

## 虚拟群友（见 docs/prd/0001-virtual-group-member.md）

- **[deferred] 定时主动抛话（A2）**：bot 在没人触发时自己主动冒泡发言。本次不做。
  - 后续由**外部信息搜集系统**驱动（频率、时机由该系统决定）。
  - 上线前必须加频率上限，避免变成刷屏 bot。

## Compaction 封装（见 docs/prd/0002-compact.md）

- **[deferred] 把 compaction 的封装泄漏收敛进 Agent**：目前 compaction 由外部直接改写 `agent.history`，有封装泄漏。候选方案待定，等有其它架构需求时一起定。
  - 泄漏点：(1) `compact.ts` 的自由函数 `compactAgent` 从外部改写 `agent.history`（2–3 次整体重写，并从 `agent.template.systemPrompt` 重建 system 条目，需知道 agent 内部布局）；(2) orchestrator 的 metering（`compactIfNeeded`）深入 `agent.history` 找最后一条 assistant 做增量估算——metering 是 agent 关注点却住在 orchestrator；(3) 摘要以 `SUMMARY_MARKER` 字符串埋在 system 条目里，由 `extractPreviousSummary` 反解析，两模块需约定格式。
  - **Option A（推荐）— Agent 方法**：`meteredTokens()` + `compact(provider)` 移进 Agent，agent 成为 history 唯一写入者；`compact.ts` 退化为纯函数工具（estimate/findWaterline/applyRuleBased/llmSummarize 已是纯函数）；orchestrator 只 `if (agent.meteredTokens() < threshold) skip; await agent.compact(provider); save()`。改动最小、最直接消除泄漏，无持久化迁移。
  - **Option B — 抽取 `History` 值对象**：新建 `History`（entries + lastPromptTokens + summary + 不变量校验，如 system 条目恒在 0、tool 与 tool_calls 配对），Agent 持有并委托（`agent.compact` / `agent.meteredTokens`）。最干净、不变量集中一处、agent 变薄；代价是新增类型 + 极小的 serialize 迁移。
  - **Option C — 最小改动**：`compactAgent` 改纯函数返回新状态（不碰 agent），Agent 加 `applyCompaction()` 作为单一写入点；metering 留在 orchestrator。对 `compact.ts` 改动最少、仍高度可测；但 metering 泄漏只修一半。
  - **与已锁定点的冲突（先改 ADR/PRD 再选）**：PRD「Implementation Decisions」已锁定“压缩逻辑不进 Agent 类（Agent 拿不到 provider，保持其『处理单个事件』职责）”——Option A/B 均与之冲突，采用前需先更新该决策与 `docs/prd/0002-compact.md`。`history[0]` 恒为 system 条目 + marker 存储摘要是另一条锁定点，**建议保留**（保持 `agent.history` == 直接发给 LLM 的内容，无需发送时重建）。
  - 建议顺序：先 A（最小、消除泄漏）→ 需要更强不变量时再上 B。

## Telegram 实现收敛（app → 库 backport）

- **[todo] 把 app 侧 telegram 输入/输出处理中的通用部分 backport 进库的 telegram 实现**：目前 app（`apps/telegram-bot/telegram-router.ts` 的 `SmartTelegramRouter`、`telegram-bot.ts` 的 batch 输入整形）承载了库 `Telegram` OutputRouter / `TelegramInputAdopter` 没有的行为。候选项：
  - **OutputRouter 空内容防护**：库的 `route` 已加最小防护（空内容直接返回，不再发 API）——因为现在每个 Agent 的 turn-ending 输出都会被路由，空 Report 也会到达 router。app 侧仍保留 trim / 去引号 / `""`、`''` 判断，backport 待定。
  - **贴纸 token 协议 `[[sticker:id]]`**：解析 token → 从文本移除 → `sendSticker` 发送。backport 形式：库构造器接受可选 sticker 目录 `Array<{ id; fileId }>`（`STICKERS` 数据注册表留 app）。
  - **Pin token 协议 `[[pin:id]]`**：替换为占位符并带 `reply_to_message_id` 发送。库形式：可选 pin 目录 `Array<{ id; messageId }>`。
  - **dry-run（app 的 TEST_MODE）**：只打日志不发送。库形式：构造器 `dryRun` 标志。
  - **Compacted 策略需先定**：库默认把 compact notice 作为用户可见消息发（`📦 Compacted history…`），app 选择只打日志不发。backport 时定一个库级默认（如默认发送、可关），而不是各 app 各自为政。
  - **InputAdopter 时间戳前缀**：`[HH:mm:ss]` 目前由 app 的 `formatInputParts` 加；它给 LLM 的消息时序/批量边界是通用信息，可移进库 adapter 的 `assemble`。
  - **不 backport（留 app）**：`/compact` 命令识别与 `compact_request` 路由（app 自有命令）、STICKERS/PINS 数据、4h idle 重置、batch 合并策略、api_callback XML 渲染。
  - 执行时给新逻辑补 Vitest（token 解析、空内容、dry-run），app 改用库 `Telegram`（传目录/dryRun）后删除 `SmartTelegramRouter`。
