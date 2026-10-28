# 对话历史归 conversation 节点，agent 不存 history

history 要能被别人读：常见需求是让一个判断模型（judge）先看一遍历史，决定这次是交给 LLM 补全，还是直接给固定回复。但内核只给节点**自己的**私有状态（ADR-0004），节点之间没有共享状态，也不能偷看。所以只要 history 长在 agent 身上，judge 就永远读不到它。

**Status**: accepted；取代 ADR-0009 中「history 是 agent 的私有状态」这一条（其余各条不变）。

## 决定

- **新增一份节点定义 `conversation`**（agents 包）：私有状态就是**对话历史**。
  - 收到 `user`（`{ text }`）→ 记成一条 user 消息；
  - 收到 `append`（一条 `HistoryMessage`）→ 原样记为最后一条；
  - 每记完一条就沿 `history` 端口发出**整份**快照（`History`）。
  - 它不判断该不该问模型，也不压缩、不裁剪。
- **agent 不再持有 history**：`agentStateSchema` 只剩 `{ modelCall?, pending, nextCall }`。
  - 收到 `history` 快照：`answerable(history)`（最后一条是 `user` 或 `tool`）且自己没在等东西，就把 `system` 前置、交出一个 `model.complete`；否则什么都不做。
  - 收到回执：把 assistant 消息沿 `append` 记回去；有工具调用就各发一条 `tool.<name>`；没有就沿 `reply` 回话。
  - 收到 `tool.result`：沿 `append` 记回去、从 `pending` 删掉；记完之后 conversation 会送来新的快照，工具循环靠它接上。
- **端口名固定三个**，常量在 `history.ts`：`user`（外面说了句话）、`append`（一条要记的消息）、`history`（整份快照）。端口名就是消息类别（ADR-0005）。
- **subagent 给子 agent 也起一个 conversation**：`spawnOps` 里成对新增、成对回收，任务发给子 agent 的 conversation 而不是 agent 本身。
- **版本**：agent 升到 v2。`migrate` 在旧状态上看到 `history` 就直接抛——搬到一个不存在的 conversation 里没有诚实的自动迁移可做，停住让人处理（ADR-0008），不静默丢对话。

## 为什么

- **为什么走消息而不走共享状态**：内核级共享只读状态能把拷贝降到零，但它要重新回答「共享状态的 schema 与版本归谁」「升级后谁迁移它」「节点间隐含耦合会不会绕过端口」这三个问题；只为让 judge 读 history，不值得开这个口子（ADR-0004 的主线是节点只看到自己的东西）。
- **为什么发整份而不是增量**：judge 这类消费者不该自己攒后端状态。发整份，它拿到的就是一份可判的 history；发增量，每个消费者都要维护一份镜像，history 就有第二份真源。
- **为什么 `answerable` 看最后一条的 role**：agent 把自己的 assistant 消息也记回去，若不看 role，这条快照会把它重新叫醒，形成「自问自答」的死循环。最后一条是 user 或 tool 才问，规则是纯函数，重放一致。
- **为什么 conversation 不做任何判断**：判断属于消费者（agent 决定问不问模型，judge 决定怎么路由）。conversation 只记账，才可能被两个消费者共用同一个端口约定。

## 代价（接受）

- 每一轮多 1–2 次转移：user → conversation → agent、回执 → agent → conversation → agent。转移是要落盘的，写得更多。
- history 会被复制进消息载荷：conversation 发出的整份快照、judge 转给 agent 的那一份、以及 `model.complete.input.messages`。快照体积与写入量因此变大，长对话更容易撞上 `maxSnapshotBytes`（第一版仍是**停住**，ADR-0008）。
- 一个 agent 必须和一个 conversation 配对，两条边（`conversation.history → agent`、`agent.append → conversation`）由作者手写。没有把它硬接进 `agentLayout`：judge 恰好要插在这两条边中间，硬接线反而挡路。
- 一个端口在形状里最多接一个目标，所以要两个消费者（judge + 摘要）就得在 conversation 上开第二个出口端口。ADR-0010 只开一个。
- 旧快照（agent v1）里的 history 需要人工搬到新起的 conversation 节点上。

## Retired designs（不要重提）

- **history 是 agent 的私有状态**（ADR-0009 的那一条）。
- **agent 保留 history，再把副本推给消费者**：两份真源，迟早漂。
- **内核级共享只读状态**：schema/版本归属与跨节点隐含耦合的代价远大于收益，见「为什么」。
- **judge 自己实现"读 history"的请求-应答往返**：conversation 已经主动发快照，不需要 pull。

## 反转条件

- 如果「多个消费者同时只读 history」成为常态（judge + 摘要 + 长期记忆），先在 conversation 上开多个出口端口；若端口数量本身成为噪声，再讨论内核级共享只读状态。
- 如果额外的转移与载荷被证明是主要成本（例如长对话下快照频繁超限），再讨论「只把尾部窗口发给消费者」或重开共享状态。
