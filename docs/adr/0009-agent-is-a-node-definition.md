# agent 是一份节点定义，循环是图结构；subagent 是普通节点

内核不认识 LLM。`arbetslag/agents` 包提供 agent 这份节点定义：私有状态是对话历史；收到消息时交出一个 `model.complete` 效果，收到 `@effect.end` 时要么沿 `reply` 端口发出回复，要么沿工具端口发出工具调用。工具是别的节点，结果沿回边回到 agent；"循环"由回边构成，不是 agent 内部的 while。

**Status**: accepted；「history 是 agent 的私有状态」一条已由 **ADR-0010** 取代（history 挪到 `conversation` 节点），其余各条不变。

## 决定

- **agent 不是内核概念**：它是 agents 包里的一份节点定义，和别的节点没有任何区别（ADR-0004、ADR-0006）。
- **history 是 agent 的私有状态**（**已被 ADR-0010 取代**：history 在 `conversation` 节点里）。模型调用是效果（`model.complete`），回执 `@effect.end` 回来之后才继续；Run 不等它（ADR-0006）。
- **一个工具一个端口，端口由 config 推出**：agent 的端口声明是 config 的纯函数（`ports(config)`），config 里有 `tools`，每个工具对应一个 `tool.<name>` 端口，外加 `reply`。
- **工具 schema 来自 agents 包自己约定的元数据**：工具节点定义带一份（名字、描述、input schema）；agents 包提供模板构建 helper，在**构建模板时**把它们抄进 agent 的 config，并同时生成对应的边。作者只写一遍，不手写重复的 `tools` 与 `edges`。内核不知道这份元数据，也不提供 `ctx` 去查询"我某个端口接的是谁"。
- **运行时新增的工具**由同一个 helper 生成一个 `graph.mutate`：创建新的 agent 并接线，不修改老 agent 的 config。节点要等它的回执（成功）回来，才能把消息发给新节点。
- **并行工具调用**：模型一次返回多个调用时，agent 为每个调用各发一条消息（各走自己的 `tool.<name>` 端口，`body` 里带 `callId`），把 `pendingCallIds` 记进自己的 state；每个结果沿回边回来，按 `body.callId` 配对并从集合里删掉；集合空了才发下一次 `model.complete`。
- **subagent 只是工具节点的一种**：收到调用时，交出一个 `graph.mutate`（新增一个 child agent，config 来自自己 config 里的模板片段，并接上 child 的 `reply` 回边）和一个 `timer.wait` 当超时；state 里记 `{ callId → { childId, 阶段 } }`。改图的回执成功后，再把任务发给 child；失败就回一条失败结果。两条结束路径都要幂等：child 回复 → 交出 `graph.mutate` 回收 child、沿结果端口发回结果；超时先到 → 回收 child、回一条失败结果；按 `callId` 是否仍在判断，已处理过的直接忽略。
- **第一版不压缩 history**：撞单条快照上限就停住，让它可见（ADR-0008）。摘要、截断等以后作为独立节点或 helper 加，不改 agent 本身。
- **history 的消息格式由 agents 包定义**，与模型厂商无关：role、文本块、工具调用块、工具结果块。
- **`model.complete` 效果**：`input = { model, messages, tools, params? }`，`correlationId` 由 agent 自己给；`@effect.end` 的 `body.result` 是 `{ ok: true, message }` 或 `{ ok: false, error }`，失败时 agent 自己决定重试或把错误当回复发出（ADR-0006）。厂商特有参数放 `input.params`，对 agents 包不透明，由对应 performer 包（如 `arbetslag/openai`）解释并把 history 翻译成具体 API。
- **等待是 state 里的集合**，不依赖内核的任何等待机制（ADR-0007）。

## 为什么

- **为什么循环是图结构**：agent 若内部循环，就要在一次转移里 await 模型与工具，而 step 是同步纯函数（ADR-0004）。拆成"一次转移一步"，每一步都能落盘、被观察、被重放。
- **为什么端口是 config 的函数**：一个 agent 有几个工具是每份工作流各自的事；端口固定会逼出一个只做转发的路由节点，而且路由规则要在两处重复写工具名。纯函数保持内核可校验。
- **为什么 helper 在构建时抄 schema**：step 看不到别的节点的定义，加 `ctx` 查询等于给内核开一个"节点互相窥探"的口子（与 ADR-0004 相反）；让作者手写则会漂移。构建期是唯一同时看得到两边定义的时刻。

- **为什么 subagent 不特殊**：新增节点、接线（都是 `graph.mutate` 效果）、等待、超时都已是普通转移能做的事，给它开后门只会让内核认识一种"节点"。
- **为什么不先做压缩**：压缩策略因应用而异，第一版拍脑袋定默认会写死一个错的默认；停住是显式失败，不会悄悄丢上下文。
- **为什么格式归 agents 包**：内核不认识 LLM；history 直接用某厂商格式，会把换模型变成迁移 state。

## 代价（接受）

- 工具的 schema 在 agent 的 config 里有一份拷贝；只要不绕过 helper 手改，两边不会漂移，但内核不检查一致性。
- 节点定义要多一个 `ports` 字段，端口声明因此依赖 config。
- 长对话在第一版里会被停住，需要人处理；subagent 两条结束路径漏写幂等判断，会在竞态下重复回结果；每新增一个厂商，performer 包要写一份 history 格式翻译。
- 模板里 `tools` 与 `edges` 的重复写法是否提供语法糖，留给实现，本 ADR 不定。

## Retired designs（不要重提）

- **agent 是内核概念 / 内核认识 LLM**。
- **agent 内部循环 / 在 step 里 await 模型或工具**。
- **沿端口向目标要 `describe()`**，以及 `ctx` 暴露"端口接的是谁的哪份定义"。
- **固定的单个 `tool` 端口加分发节点**。
- **`awaiting` 驱动的 subagent**（见 ADR-0007）；**第一版内置的 history 压缩 / 自动截断**；**history 直接采用厂商格式**。

## 反转条件

- 如果停住长对话成为常态，就在 agents 包里提供压缩 helper 或节点，而不是改内核或让 agent 内置。
- 如果厂商格式的差异大到翻译层失真，重新讨论 history 格式是否留出不透明的扩展块。
- 如果构建期抄 schema 在运行时频繁失配（工具节点升级后 agent 的拷贝落后），再讨论让 config 引用工具定义的版本而不是拷贝内容。
