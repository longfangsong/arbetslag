# 命名约定

不是领域决定（那些在 `docs/adr/`），也不是术语（那些在 `CONTEXT.md`），只是代码里几个容易混用的词的用法。

## `type` 与 `kind`

1. **`type` 只表示消息类别。** 只用于 `Message.type` 与端口名（端口名就是沿它发出的消息的类别，ADR-0005）。
2. **`kind` 只表示宿主注册表里的键。** 即效果种类、触发器种类。它总是和一份 schema 配对，并带一个载荷字段（`config` 或 `input`）。节点没有 kind（ADR-0004）。
3. **其它内部的判别联合不用这两个词。** 按领域选更具体的词：违规、停住原因、错误用 `code`。改图操作用 `op`（`spawn`、`retire`、`connect`、`disconnect`、`addTrigger`、`removeTrigger`）。其余的（history 内容块等）在实现到时再定，定了补进这里。
4. **新增注册表时沿用 `kind`**，并在 `CONTEXT.md` 里给它起一个对应的术语。

## 宿主侧的词

宿主那一侧的概念（**Performer**、执行器、未就绪、恢复扫描、串行入口……）也是**术语**，定义在 `CONTEXT.md` 的「宿主」。这里只留两处纯命名的选择：

1. **`Performer` 不翻译。** 中文候选「执行者」与「执行器」（Executor）一字之差，读代码时分不清；写成英文，两样东西至少长得不一样。
2. **「串行入口」的实现叫 `KeyedQueue`，那只是机制的名字，不是术语。** 它按 key 分组：同一个 key 内按进入顺序串行，不同 key 并行；排队的单位是一段代码，不是数据。
   - 不叫 `WorkflowQueue`：读成「某份工作流的队列」（所有权），而它是「按工作流 id 分组的一堆队列」。
   - 不叫 `TaskQueue`：`task` 是**效果**的 `_Avoid_` 词（`CONTEXT.md`）；而且 `TaskQueue` 读成**一条**全局队列，说不出「每个 key 一条」。
   - 不叫 `Lock` / `Mutex`：没有「持有」这回事，只有「排到队尾」。
   - 方法不叫 `run`：那是内核动词（`run(store, registry, id)`），用 `add`。

## 动词：`run` / `drive` / `submit` / `recover` / `reconcile`

1. **`run`** 只在核心里：把**图**推一步，直到**静止**或预算用完。宿主不叫它。
2. **`drive`** 是宿主的：把一份**工作流**推到静止——先补交在飞**效果**、再 `run` 到没得推。执行器里叫 `driveWorkflow`，入口里叫 `drive(host, id)`（走**串行入口**）。
3. **`submit`** = 投递 + `drive`，一次调用（ADR-0001：投递 = 一次写 + 一次 Run）。`submitFromTrigger` 是它的触发器版本。
4. **`recover`** 是一次**恢复扫描**（多份工作流），内部对每份调 `drive`。
5. **`reconcile`** 是**对账**（一份工作流）：声明 vs 正在跑的监听。
6. 不叫 `advance` 当宿主动词：核心里已经有一个 `advance`（推进图的一步）。

## 端口名与效果名

1. **端口名就是消息类别**（ADR-0005），所以名字要说「这条消息是什么」，不说「它从哪来」。`reply`、`user`、`tool.<工具名>`、`tool.result` 都是这个形式。
2. **`tool.<工具名>` 与 `tool.result` 是成对的**：agent 沿前者发出**工具调用**，工具沿后者回**工具结果**。两边都从 `toolPort()` / `TOOL_RESULT_PORT` 取，名字不手写。
3. **效果种类的名字是 `<名词>.<动词>`**：`graph.mutate`、`model.complete`、`timer.wait`、`log.line`。不是 `completeModel`，也不带实现细节。
4. **谁发谁声明**：`graph.mutate` 归内核，`model.complete` / `timer.wait` 归 agents 包，`log.line` 之类归应用；**Performer** 归宿主。注册表里只注册一次，所以声明与实现必须各在一处。
5. **回执按 `correlationId` 配对**。一个节点同时交几种效果时，用 `<前缀>:<自己的键>` 区分（subagent 用 `spawn:` / `timeout:` / `retire:`），并只认自己认得的前缀——别人的回执一律忽略。
