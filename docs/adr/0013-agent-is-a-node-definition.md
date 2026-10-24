# agent 是一份节点定义，循环是图结构

内核不认识 LLM。`arbetslag/agents` 包提供 agent 这份节点定义：私有状态是对话历史；收到消息时交出一个 `model.complete` 效果，收到 `@effect.end` 时要么沿 `reply` 端口发出回复，要么沿工具端口发出工具调用。工具是别的节点，结果沿回边回到 agent；"循环"由回边构成，不是 agent 内部的 while。

**Status**: accepted

## 决定

- **agent 不是内核概念**：它是 agents 包里的一份节点定义，和别的节点没有任何区别（ADR-0007、ADR-0011）。
- **history 是 agent 的私有状态**。模型调用是效果（`model.complete`），回执 `@effect.end` 回来之后才继续；Run 不等它（ADR-0008）。
- **一个工具一个端口，端口由 config 推出**：agent 的端口声明是 config 的纯函数（`ports(config)`），config 里有 `tools`，每个工具对应一个 `tool.<name>` 端口，外加 `reply`。
- **工具 schema 来自 agents 包自己约定的元数据**：工具节点定义带一份（名字、描述、input schema）；agents 包提供模板构建 helper，在**构建模板时**把它们抄进 agent 的 config，并同时生成对应的边。作者只写一遍，不手写重复的 `tools` 与 `edges`。内核不知道这份元数据，也不提供 `ctx` 去查询"我某个端口接的是谁"。
- **运行时新增的工具**由同一个 helper 在转移里生成：创建新的 agent 并接线，不修改老 agent 的 config。
- **并行工具调用**：模型一次返回多个调用时，agent 为每个调用各发一条消息（各走自己的 `tool.<name>` 端口，`body` 里带 `callId`），把 `pendingCallIds` 记进自己的 state；每个结果沿回边回来，按 `body.callId` 配对并从集合里删掉；集合空了才发下一次 `model.complete`。
- **等待是 state 里的集合**，不依赖内核的任何等待机制（ADR-0012）。

## 为什么

- **为什么循环是图结构**：agent 若内部循环，就要在一次转移里 await 模型与工具，而 step 是同步纯函数（ADR-0007）。拆成"一次转移一步"，每一步都能落盘、被观察、被重放。
- **为什么端口是 config 的函数**：一个 agent 有几个工具是每份工作流各自的事；端口固定会逼出一个只做转发的路由节点，而且路由规则要在两处重复写工具名。纯函数保持内核可校验。
- **为什么 helper 在构建时抄 schema**：step 看不到别的节点的定义，加 `ctx` 查询等于给内核开一个"节点互相窥探"的口子（与 ADR-0007 相反）；让作者手写则会漂移。构建期是唯一同时看得到两边定义的时刻。

## 代价（接受）

- 工具的 schema 在 agent 的 config 里有一份拷贝；只要不绕过 helper 手改，两边不会漂移，但内核不检查一致性。
- 节点定义要多一个 `ports` 字段，端口声明因此依赖 config。
- 模板里 `tools` 与 `edges` 的重复写法是否提供语法糖，留给实现，本 ADR 不定。

## Retired designs（不要重提）

- **agent 是内核概念 / 内核认识 LLM**。
- **agent 内部循环 / 在 step 里 await 模型或工具**。
- **沿端口向目标要 `describe()`**，以及 `ctx` 暴露"端口接的是谁的哪份定义"。
- **固定的单个 `tool` 端口加分发节点**。

## 反转条件

- 如果构建期抄 schema 在运行时频繁失配（工具节点升级后 agent 的拷贝落后），再讨论让 config 引用工具定义的版本而不是拷贝内容。
