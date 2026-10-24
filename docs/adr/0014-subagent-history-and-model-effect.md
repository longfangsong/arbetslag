# subagent 是普通节点，history 不压缩，模型效果与厂商无关

subagent 只是工具节点的一种：收到调用时新增一个子 agent、接回边、交出超时效果，收到子 agent 的回复或超时之后回收它并回结果。history 在第一版不做压缩，撞上快照上限就隔离。`model.complete` 效果的 history 格式由 agents 包自己定义，与模型厂商无关；翻译成具体 API 是 performer 包的事。

**Status**: accepted

## 决定

- **subagent 是一份节点定义，没有内核特殊性**。收到调用时，在一次转移里：新增一个 child agent（config 来自自己 config 里的模板片段）、接上 child 的 `reply` 回边、把任务发给 child、交出一个 `timer.wait` 效果当超时；state 里记 `{ callId → childId }`。
- **两条结束路径都要幂等**：收到 child 的回复 → 回收 child、沿结果端口把结果发回；超时先到 → 回收 child、回一条失败结果。两者都按 state 里 `callId` 是否仍在来判断，已经处理过的那一条直接忽略。
- **第一版 agents 包不压缩 history**。撞单条快照上限就隔离，让它可见。摘要、截断等策略以后作为独立的节点或 helper 加，不改 agent 本身。
- **history 的消息格式由 agents 包定义**，与模型厂商无关：role、文本块、工具调用块、工具结果块。
- **`model.complete` 效果**：`input = { model, messages, tools, params? }`，`ref` 由 agent 自己给；`@effect.end` 的 `body` 是 `{ ok: true, message }` 或 `{ ok: false, error }`。失败是 body 的一种形状，agent 自己决定重试或把错误当作回复发出去（ADR-0008）。
- **厂商特有参数放 `input.params`**，对 agents 包不透明，只由对应的 performer 解释；`arbetslag/openai` 这类包负责把 history 格式翻译成具体 API。

## 为什么

- **为什么 subagent 不特殊**：它要的一切——新增节点、接线、等待、超时——都已经是普通转移能做的事（ADR-0002、ADR-0008、ADR-0012），给它开后门只会让内核认识一种"节点"。
- **为什么不先做压缩**：压缩策略因应用而异，第一版拍脑袋定默认会写死一个错的默认；而隔离是显式失败，不会悄悄丢掉上下文。
- **为什么格式归 agents 包**：内核不认识 LLM；让 history 直接用某个厂商的格式，会把换模型变成迁移 state。

## 代价（接受）

- 长对话在第一版里会被隔离，需要人处理。
- subagent 的两条结束路径都要写幂等判断，漏写会在竞态下重复回结果。
- 每新增一个厂商，performer 包要写一份 history 格式的翻译。

## Retired designs（不要重提）

- **`awaiting` 驱动的 subagent**（见 ADR-0012）。
- **第一版内置的 history 压缩 / 自动截断**。
- **history 直接采用厂商格式**。

## 反转条件

- 如果隔离长对话成为常态，就在 agents 包里提供压缩 helper 或节点，而不是改内核或让 agent 内置。
- 如果厂商格式的差异大到翻译层失真（例如特有的内容块无法表达），重新讨论 history 格式是否留出不透明的扩展块。
