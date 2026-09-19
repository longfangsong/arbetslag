# 0003 — Sub-agent（Agent 创建 Agent）

> 状态：Spec（需求已锁定）
> 关联：`packages/arbetslag` 框架核心，涉及 Agent / Template / Tool / Event / Orchestrator / Chat

## Problem Statement

单个 Agent 的历史只增不减。当一次工作很"重"——翻大量文件、跑长串检索、读很多网页——这些过程性内容会全部堆进发起者的历史里，稀释它的注意力，也让它后续工作变差。（框架侧已有 Compact 处理历史膨胀，但 Compact 是"丢弃细节换摘要"，无法让"重活本身"发生在发起者上下文之外。）

用户观察到的需求是：Agent 需要能把一块工作**交出去**，用另一个 Agent 的独立上下文去完成，然后只拿回结果——发起者看到的是结论，而不是几百条工具调用的过程。

当前框架没有任何 Agent 之间协作的能力：`CONTEXT.md` 声称框架内置 sub-agent spawning，但代码里不存在任何相关工具；Agent 之间也没有任何通信通道。

## Solution

引入 **Sub-agent**：一个由另一个 Agent（其 **Creator**）创建的普通 Agent——不是新的实体类型，只是"Agent + Creator 关系"。

从 Creator（LLM）的视角，一次使用是这样的：

1. **创建即返回**：Creator 用一个工具创建 Sub-agent 并交出任务，调用立刻完成，不等待任何结果。Sub-agent 由 Creator 选定的、启动时已声明的 **Template** 定义。
2. **结果回报给 Creator**：Sub-agent 完成工作后，它的最终答复交付给 Creator（不是用户）。用户不会看到 Sub-agent 的发言——用户只与 Chat 的 entry agent 交互。
3. **需要结果时等待（Wait）**：Creator 可以等待它点名的那些 Sub-agent 的回报。等待期间执行权让出——事件队列照常处理其它工作，不会被这个等待卡死。等待在回报到达（成功或失败）时结束。
4. **能力由 Template 决定**：能否创建、能否给同一个 Sub-agent 追加后续任务，取决于该 Template 是否允许相应工具。框架只提供这些能力，不强制。

不变式：Sub-agent 也是 Agent，同样永生（append-only 仓库）；深度有全局上限；Creator 只看得到回报，看不到 Sub-agent 的历史；Sub-agent 只知道自己的任务、以及它的 Creator 是谁；Sub-agent 属于 Creator 的 Chat，共享 runtime 与 filesystem。

## User Stories

### 创建

1. As a framework user, I want an Agent to be able to create a Sub-agent, so that heavy work can happen in an isolated context instead of filling the Creator's history.
2. As a Creator agent, I want the create call to complete immediately, so that I keep control of the conversation and don't stall on a long-running task.
3. As a Creator agent, I want to hand the task in the create call itself, so that the common case is one tool call rather than create-then-message.
4. As a Creator agent, I want to pick the Sub-agent from a pre-declared Template, so that Sub-agents are defined by configuration I control, not by whatever the LLM improvises at call time.
5. As a framework user, I want Sub-agents to be ordinary Agents, so that there is only one entity concept and existing Agent behavior (history, compaction, persistence) applies unchanged.
6. As a framework user, I want the created Sub-agent to be persisted like every other Agent, so that it remains inspectable and addressable after its work is done.
7. As a Creator agent, I want to send follow-up tasks to a Sub-agent I already created, so that accumulated context is preserved across turns of the same piece of work.
8. As a framework user, I want the ability to send follow-up messages to be enabled per Template, so that a template can define a Sub-agent as fire-and-report only.
9. As a framework user, I want creation to be allowed for any Agent whose Template permits it — including the Chat's entry agent — so that there is no special "orchestrator agent" role.

### 结果回报

10. As a Creator agent, I want the Sub-agent's final answer delivered to me, so that I get the conclusion without carrying the process.
11. As a Creator agent, I want the delivery to be automatic when the Sub-agent ends its turn, so that a Sub-agent can't "forget" to report and leave me waiting forever.
12. As a chat user, I want the Sub-agent's answer to go to its Creator rather than to me, so that I only receive replies from the agent I actually talked to.
13. As a chat user, I want no agent in the Chat competing to answer my message, so that the entry agent remains the single voice toward the user.
14. As a Creator agent, I want to see only the Sub-agent's reports, not its history, so that the context isolation I created the Sub-agent for is actually preserved.
15. As a Sub-agent, I want to know only my task and who my Creator is, so that I can do my work and report back without inheriting someone else's context.

### Wait

16. As a Creator agent, I want a tool to wait for the reports of the Sub-agents I named, so that I can act on a result when it's needed.
17. As a Creator agent, I want Wait to return results for exactly the Sub-agents I asked for, so that I can fan out several Sub-agents and collect their reports individually.
18. As a framework user, I want a Wait to yield execution so the event queue keeps being processed, so that a waiting Creator never blocks the work of the Sub-agent it is waiting on (or any other agent).
19. As a framework user, I want a pending Wait to survive checkpointing and restart, so that a program stopped before the queue drains can resume and the waiting Creator is still resolved when the report arrives.
20. As a framework user, I want Wait to be non-interruptible — a new user message does not cancel it — so that a Creator has exactly one open thread and no pending-wait bookkeeping across turns.
21. As a framework user, I want no timeout on Wait, because every Wait resolves: the wait graph is a tree (a Creator can only wait for agents it created), a Sub-agent always ends its turn with a final answer, and failures are reported.
22. As a framework user, I want the wait graph to be a tree, so that two agents can never wait on each other and deadlock by waiting is structurally impossible.

### 深度与失败

23. As a framework user, I want a global maximum nesting depth (3), enforced at creation, so that a model can't recurse Sub-agents without bound.
24. As a Creator agent, I want the create call to return an error when the depth limit is exceeded, so that I can report the failure and choose another approach.
25. As a framework user, I want the depth limit to be a single global value rather than a per-Template setting, so that a Template cannot silently exceed it.
26. As a Creator agent, I want a Sub-agent's failure to reach me as a report, so that I am not left waiting on a Sub-agent that can no longer answer.
27. As a framework user, I want Sub-agent failure to be the explicit exception to the fail-fast policy (which otherwise crashes the processing cycle), so that one Sub-agent's error doesn't take down the whole run.

## Testing Plans

- **创建即返回**：调用创建工具后，事件队列中没有该 Sub-agent 的未完成工作也必须能继续被处理；创建工具的结果不含工作结果。
- **任务即首条消息**：创建时交出的任务成为 Sub-agent 历史中的第一条 user 形态条目（计入 Round 边界，与 Compact 的轮定义一致）。
- **自动回报**：Sub-agent 产生无 tool_calls 的最终答复时，Creator 收到来自该 Sub-agent 的回报；Sub-agent 不调用任何"报告"工具也能送达。
- **不路由给用户**：Sub-agent 的最终答复不进入 OutputRouter；用户视角只有 entry agent 的发言。
- **Wait 语义**：点名 N 个 Sub-agent 的 Wait，只返回这 N 个的回报；其中一个已回报、其余未回报时，Wait 让出执行权，队列继续处理其它事件（含被等待的 Sub-agent 的工作），回报到达后解析。
- **等待图是树**：构造两个 Agent 互相等待的场景，验证框架不允许（只能等待自己创建的 Agent）。
- **深度上限**：depth 1 → 2 → 3 允许，从 depth 3 再创建时返回错误；验证全局值不被任何 Template 配置绕过。
- **失败上报**：Sub-agent 处理过程中出错时，Creator 收到失败回报，处理循环不崩溃、状态照常 checkpoint。
- **持久化与恢复**：处于等待中的 Creator 经过 serialize → checkpoint → restore 后，仍能在回报到达时被解析；Sub-agent 本身在重启后仍可被寻址。
- **不可中断**：等待期间到达的用户消息不取消等待；该消息按现有规则正常处理（同一 Agent 的等待状态保持不变）。
- **封装边界**：验证 Creator 无法读取 Sub-agent 的 history（只有回报内容可见）。
- **Template 开关**：Template 不含创建工具时调用失败；不含后续消息工具时只能创建、不能追加任务。
- **共享与隔离**：Sub-agent 与 Creator 共享 filesystem 与 runtime（如 memory 文件可互相看到），但 history 各自独立；Sub-agent 归属 Creator 的 Chat。

## Out of Scope

- **Sub-agent 与外界通信**（直接对用户发言、调用外部渠道）：本次不做，记入 backlog。本次它唯一的对外通道是它的 Creator。
- **向任意 Agent 发消息**：本 Spec 只覆盖 Creator → 自己创建的 Sub-agent 的后续消息；任意 Agent 之间的通信是独立特性。
- **等待的中断/取消、超时**：明确不做，等出现"等待非自己创建的 Agent"这类需求时再考虑。
- **按 Template 配置深度上限**：只做全局上限。
- **Sub-agent 的销毁 / 生命周期**：不存在"结束"或"回收"，仓库仍是 append-only；无人再对话的 Sub-agent 就是留着。
- **结果结构化 schema**（强制 JSON 报告）：回报为自由文本，等观察到模型丢关键信息再考虑。
- **并发/成本治理**（每 Agent 的 Sub-agent 数量上限、token 预算、模型选择策略）：不做，等真实成本问题出现。
- **等待期间给 Creator 注入"正在等待"提示**、UI 展示 Sub-agent 状态：不做。
- **Wait 需要改动 Orchestrator 契约（工具可在等待时让出执行权）与 checkpointing 对 pending tool call 的处理**：这是实现层面的后果，不在本 Spec 内决定；本 Spec 只锁定可观察行为——等待不阻塞队列、等待可跨重启存活。

## Further Notes

- `CONTEXT.md` 声称框架"内置 sub-agent spawning"，此前无任何实现；本 Spec 是这一声明的第一次落地，术语（Sub-agent / Creator / Wait / Same Chat）已写入 glossary。
- 术语：用 **Creator**，不用 Parent——Parent 暗示子代会消亡，与 Agent 永生矛盾。工具名（`spawn` / `wait` / `send_message`）属实现层，不进 glossary。
- 与现有决策的冲突点需在实现时解决：`agent_output` 目前无条件路由到 OutputRouter，对 Sub-agent 必须例外（回报给 Creator，而不是用户）；fail-fast 规则对 Sub-agent 失败需例外（回报而不是崩溃）。
- "等待让出执行权"是 Orchestrator 契约变化：当前 `step()` 会 await 完整个 handler 后才处理队列中的下一个事件，因此工具内阻塞式等待在当前模型下不可能。
- 实现层已对齐，见 `docs/adr/0003-wait-as-unresolved-tool-call.md`（Wait = 未响应的 tool call；等待期间的入站事件挂起；Report 只能经 Wait 消费；pending 状态存于 agent 记录而非队列）。
- 依赖 `docs/prd/0002-compact.md`：Sub-agent 的历史膨胀同样由 Compact 治理，且隔离效果正是本 Spec 的动机；Sub-agent 的回报进入 Creator 时按 Round 边界参与压缩。
