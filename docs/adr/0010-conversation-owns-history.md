# 对话历史归 conversation 节点，LLM 节点不存 history

history 要能被别人读：常见需求是让一个判断模型（judge）先看一遍历史，决定这次是交给 LLM 补全，还是直接给固定回复。但内核只给节点**自己的**私有状态（ADR-0004），节点之间没有共享状态，也不能偷看。所以只要 history 长在问模型的那个节点身上，judge 就永远读不到它。

**Status**: accepted

## 决定

- **一份节点定义 `conversation`**（`@arbetslag/llm`）：私有状态就是**对话历史**。
  - 收到 `user`（`{ text }`）→ 记成一条 user 消息；
  - 收到 `append`（一条 `HistoryMessage`）→ 原样记为最后一条；
  - 每记完一条就沿 `history` 端口发出**整份**快照（`History`）。
  - 它不判断该不该问模型，也不压缩、不裁剪。
- **LLM 节点不持有 history**：`llmStateSchema` 只有 `{ modelCall?, pending, nextCall, seen? }`。`seen` 是上次问模型时 history 的长度。
  - 收到 `history` 快照：`unanswered(history, seen)`（第 `seen` 条之后有 `user` 或 `tool` 消息）且自己没在等东西，就把 `system` 前置、交出一个 `model.complete`；否则什么都不做。
  - 交给模型的消息经过 `forModel`：等工具期间进来的 user 消息挪到那批工具结果之后（厂商要求工具调用后面紧跟结果）。history 本身不动。
  - 收到回执：把 assistant 消息沿 `append` 记回去；有工具调用就各发一条 `tool.<name>`；没有就沿 `reply` 回话。
  - 收到 `tool.result`：沿 `append` 记回去、从 `pending` 删掉；记完之后 conversation 会送来新的快照，工具循环靠它接上。
- **端口名固定三个**，常量在 `history.ts`：`user`（外面说了句话）、`append`（一条要记的消息）、`history`（整份快照）。端口名就是消息类别（ADR-0005）。

## 为什么

- **为什么走消息而不走共享状态**：内核级共享只读状态能把拷贝降到零，但它要重新回答「共享状态的 schema 与版本归谁」「升级后谁迁移它」「节点间隐含耦合会不会绕过端口」这三个问题；只为让 judge 读 history，不值得开这个口子（ADR-0004 的主线是节点只看到自己的东西）。
- **为什么发整份而不是增量**：judge 这类消费者不该自己攒后端状态。发整份，它拿到的就是一份可判的 history；发增量，每个消费者都要维护一份镜像，history 就有第二份真源。
- **为什么看「`seen` 之后有没有 user 或 tool」，而不只看最后一条的 role**：
  - LLM 节点把自己的 assistant 消息也记回去，若不看 role，这条快照会把它重新叫醒，形成「自问自答」的死循环。
  - 但只看最后一条会漏话：模型思考期间进来的 user 消息排在它的回答**之前**，回答记进去之后最后一条是 assistant，那几句就永远没人回。记下上次问时的长度，之后进来的 user / tool 都算没回过，于是再问一次、一次回完。
  - 两条规则都是纯函数，重放一致。
- **为什么 conversation 不做任何判断**：判断属于消费者（LLM 节点决定问不问模型，judge 决定怎么路由）。conversation 只记账，才可能被两个消费者共用同一个端口约定。

- **思考期间进来的话：默认一次回完，逐条回靠 `inbox`**。宿主不挡新消息（ADR-0014），所以「忙的时候怎么办」是图的语义：
  - 默认（LLM 节点自己）：回完手上这句，再把期间进来的几句一起问一次。
  - 逐条：在 conversation 前面接一个 `inbox` 节点。它在一轮没答完（history 最后一条不是不带工具调用的 assistant）时把用户的话排队，答完一轮放一句进去。history 的先后因此就是一问一答。

## 代价（接受）

- 每一轮多 1–2 次转移：user → conversation → llm、回执 → llm → conversation → llm。转移是要落盘的，写得更多。
- history 会被复制进消息载荷：conversation 发出的整份快照、judge 转给 LLM 节点的那一份、以及 `model.complete.input.messages`。快照体积与写入量因此变大，长对话更容易撞上 `maxSnapshotBytes`（会**停住**，ADR-0008）。
- 一个 LLM 节点必须和一个 conversation 配对，两条边（`conversation.history → llm`、`llm.append → conversation`）由作者手写。没有把它硬接进 `wireTools`：judge 恰好要插在这两条边中间，硬接线反而挡路。
- 多个消费者（judge + 摘要）直接接在同一个 `history` 端口上（ADR-0011），每多一个消费者就多一份整份拷贝。

- 默认模式下，history 记的是真实先后：`[问1, 问2, 答1, 答2]`。第二次问模型时它看到的是 `答1` 排在 `问2` 后面，能读懂，但不如一问一答整齐；在意就接 `inbox`。

## Retired designs（不要重提）

- **history 是 LLM 节点的私有状态**。
- **LLM 节点保留 history，再把副本推给消费者**：两份真源，迟早漂。
- **内核级共享只读状态**：schema/版本归属与跨节点隐含耦合的代价远大于收益，见「为什么」。
- **judge 自己实现"读 history"的请求-应答往返**：conversation 已经主动发快照，不需要 pull。
- **只看最后一条的 role 决定问不问**：会漏掉思考期间进来的话。
- **由宿主把整份工作流锁到模型回来，客观上逐条回答**：逐条是图的选择（`inbox`），不是宿主的副作用（ADR-0014）。

## 反转条件

- 如果「多个消费者同时只读 history」成为常态（judge + 摘要 + 长期记忆），拷贝份数随消费者线性增长；届时再讨论内核级共享只读状态。
- 如果额外的转移与载荷被证明是主要成本（例如长对话下快照频繁超限），再讨论「只把尾部窗口发给消费者」或重开共享状态。
