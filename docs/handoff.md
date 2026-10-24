# Handoff: arbetslag — 概念 1、2 已定；第 3 个（形状）待开始

日期：2026-10-22（第三轮 session）
仓库：`/home/longfangsong/Projects/arbetslag`，git HEAD `b365c4e grill harder!`
**全程用中文交流。**

---

## 0. 进度

| 概念 | 状态 | 落盘 |
|---|---|---|
| 1. 模板 | ✅ 第一轮完成 | `CONTEXT.md`、ADR-0004 |
| 2. 工作流 | ✅ 第三轮完成 | `CONTEXT.md`、ADR-0005、ADR-0006 |
| 3. 形状 | ← **下一步从这里开始** | — |

概念 2 的核对已经覆盖：定义、id、生命周期、快照外壳、投递与 Run 语义、冲突处理、恢复归属、转移日志的旁路地位。详细决定读 ADR-0005 / ADR-0006，不要在本文件里重复推演。

写权限：`CONTEXT.md`、`docs/adr/`、`docs/handoff.md` 可写。**代码文件仍然一行不许动。**

---

## 1. 这个项目是什么

**arbetslag 是一个"独立运行的 Agent workflow"的运行平台。图不是内部接线，而是产品本体：它的形状本身是一份可变、可持久的状态，agent、工具与外部渠道都是图上的参与者。**

- 部署目标：**Node 与 Workers（edge）都要**。
- 仓库形态：monorepo，框架包 + 薄应用。
- Telegram bot **不是主要方向**，只是用来校验"期望用法"的透镜。
- 现有代码（`packages/arbetslag` 约 1700 行）**只当参考，全部重来**。

---

## 2. 已落盘的文档（**不要重复它们，直接读/改**）

| 文件 | 内容 |
|---|---|
| `CONTEXT.md` | 术语表。当前 10 条：模板、实例化、工作流、快照、转移日志、消息、触发器、Run、静止、隔离 |
| `docs/adr/0001-boundary-is-triggers.md` | 内核只有 `run`；投递=一次 CAS 写+run；触发器在模型外 |
| `docs/adr/0004-template-is-read-once.md` | 模板只被读一次 |
| `docs/adr/0005-workflow-is-its-snapshot.md` | 工作流即快照；两处存盘点；Run 不等 effect；投递的 at-least-once 与冲突语义 |
| `docs/adr/0006-recovery-is-host-side.md` | 恢复扫描归宿主；`Store` 不加 `list()` |

**分工铁律**：`CONTEXT.md` 是纯术语表，不是 spec，不许塞实现细节；实现决定只进 ADR；未定的东西两边都不写。

**已知文档债**：~~ADR-0001 与 ADR-0004 都引用了「ADR-0002（形状是状态）」，但 `docs/adr/0002-*` 不存在~~ → 已补写 `docs/adr/0002-shape-is-state.md`（概念 3 定稿时）。`0003` 这个编号从未被任何文档引用，空着；下一篇新 ADR 从 `0016` 继续。

---

## 3. 架构决定（现在有效的全部）

### 3.1 边界与模板（已落盘）

- **边界只有触发器**（ADR-0001）：内核只提供 `run(workflow)`；图外的一切（webhook、轮询、cron、命令行、另一个工作流）都是 store 与 `run` 的客户端。没有 `dispatch` 动词，没有入口节点，没有 `Event` 信封。
- **模板只读一次**（ADR-0004）：实例化之后形状与状态与模板无关；工作流**不记得**自己来自哪份模板（快照里没有 `origin`）。

### 3.2 工作流（已落盘为 ADR-0005 / 0006，这里只列骨架）

- 工作流 = 一条快照；无跨 Run 常驻态；没落盘 = 没发生。
- id 不透明、等于 store key；可由实例化方指定；碰撞报错，无"已存在就复用"。
- 生命周期：`active` / `quarantined`；**静止是推导**（所有邮箱为空），不是状态；没有"完成"；`drop` 抹掉记录，不留墓碑。
- 存盘点两处：**出图前** + **Run 结束（有改动才写）**。纯图内 `sends` 不落盘。
- **Run 不等 effect**；结果作为一次新投递（`@effect.end`，无 `from`）回来。
- 投递 = 对邮箱做一次 CAS 追加；**at-least-once，内核不去重**；消息无内核 id。
- 冲突：`deliver` 重载重来 ≤3 次后抛；`run` 丢内存推进、重载重跑 ≤3 次后抛 `Conflict`。
- 转移日志是旁路（独立 key、不进快照、不参与 CAS）。
- 恢复：内核只给判定 + 幂等 `run`，**扫描归宿主**（ADR-0006）。
- 宿主**强烈推荐**（非契约）为每个工作流提供串行入口。

### 3.3 旧定、仍有意义，但仍需和用户核对（**不在任何文档里，是后续概念的底稿**）

**节点与转移**

```ts
type Transition<S> = {
  state: S;
  sends?: Outgoing[];        // 图内投递
  effects?: EffectRequest[]; // 出图请求
  spawn?: NodeSpec[];        // 形状：新增
  connect?: Edge[];          // 形状：接线
  retire?: NodeId[];         // 形状：回收
  awaiting?: Await[];        // 我在等谁，内核据此在对象消失时叫醒我
};

type Message      = { from?: NodeId; type: string; body: JsonValue };
type Outgoing     = { port: string; to?: NodeId; body: JsonValue };
type EffectRequest= { kind: string; input: JsonValue; ref?: string };
```

- 节点是**纯的、同步的状态机**：不许 await、不许 fetch、不许依赖外部结果（Run 不等 effect 让这条更硬）。
- `from` 由内核盖章，外部投递与 effect 结果都没有 `from`。
- 信封只有 `from` / `type` / `body` 三个字段（ADR-0008、ADR-0009）：应答配对靠 `from`，应用自己的关联 id 放 `body`；效果侧另有一个作者给的 `ref`，由 `@effect.end` 原样带回。
- **端口名就是消息的 `type`**：一条发射口只有一个名字，接线与接收方分派共用它；`port` 必填，`to` 可选（用于运行时新增的节点）。**入站形状归应用**（共享 schema、节点自己收窄）；`@` 前缀归内核，节点发出即隔离。
- 路由两种寻址并存：`{port}`（静态、图解析、可校验）与 `{to: NodeId}`（动态，用于 spawn 出的子节点）。

**Run 与并行**

- **Run = 推进到静止**（图内没有可执行的转移）。等子 agent 不需要任何 await 原语，只是邮箱空着。静止的工作流可能仍有在飞 effect。
- 认下的代价：单工作流吞吐上限 = 单核（扩展单位是工作流份数）；`step` 必须快；每次 Run 有**步数预算**防活锁；`step` 耗时指标不是可选项。
- 内核不知道进程、不知道时间。

**Effect**

- **执行器是注入的协作者**；内核只产生"待办 effect"。常驻宿主在本地并发跑；无状态宿主交给请求 / `waitUntil` / DO alarm。
- **失败一律是值**：协作面返回 `Result`，effect 的结果是消息，`step` 是总函数（没有失败语义，业务上的坏消息本身就是一条普通消息）。`step` 里的 bug 仍然会 throw，内核捕获它 → **隔离整份工作流**。
- performer 内部可以任意 async（fetch→解析→重试）：内核只保证 effect 级的重试语义。
- 幂等：`effectId` 即幂等键；崩溃重启后用同一 id 重发（对外部世界 at-least-once，绕不过去）。
- **回执回到发起它的节点**，发起时定死（在飞记录里的 `origin`）：不需要边，`@effect.end` 没有 `from`；origin 已被回收则结果丢弃。
- **信封只有一条 `@effect.end`**：成功与失败是它 body 的两种形状。**没有 chunk**——图不承载增量，界面流式由宿主在执行器侧旁路推（ADR-0008）。
- **对图 exactly-once**：追加邮箱与删在飞记录是同一次 CAS 写，那条记录是一次性令牌；回来即删，不留历史。
- **出口型效果也一定有回执**（body 可为空）："要不要等结果"这个问题因此消失，快照写次数没有可变分支。
- **作者责任**：发了效果就得在 step 里认识 `@effect.end`，内核不检查；漏接的表现是静止（与死锁同形），不是隔离。
- 逃生门：`compute.run` effect，把重活挪出 step。

**等待与失败**

- **`awaiting` 是一等字段**：节点声明"我在等谁"，内核维护等待注册表，在对象被回收 / 图被改写时投递 `@await.broken`。
- **承认天花板：内核无法自动区分"正常静止"和"死锁"**，两者形状相同。只能靠 awaiting 显式化 + 超时 effect + 可观测。
- retire 的连带规则：到达的消息丢弃；在飞 effect 能取消就取消、不能取消则结果废弃。
- **两类失败**（本轮已收回 supervisor）：内核无法继续（step 里的 bug、状态载入/迁移失败、改图非法）→ **整个工作流被隔离**，保留快照；effect 返回失败 → 正常业务结果，节点自己决定。**没有 supervisor、没有 `@node.failed`、没有节点级判死**：图内所有节点平等，坏消息只能由节点自己沿普通边发出（ADR-0002）。隔离是刻意的：宁可停住，也不静默丢节点或静默改图。

**持久化**

```ts
type Store = {
  load(id):    Promise<{ snapshot: Snapshot; version: number } | undefined>;
  save(id, snapshot, expectedVersion): Promise<number>;   // 版本不符 → 冲突报错
  drop(id):    Promise<void>;
};
```

- 快照 + 单调版本 + CAS。CAS 不是为并发（单写者），是安全网：部署重叠／重复 alarm 时会写失败而不是互相覆盖。
- 节点定义声明 state schema（zod），内核校验、落盘、载入再校验。状态必须可被 schema 描述（不能塞 Map / class 实例 / 闭包）。
- 迁移：节点定义自带 `version` + `migrate(state, fromVersion)`，载入时**一次跳到当前版本**（不链式）；输出由 state schema 校验，过不了（未知定义／迁移不了／记录版本比在场定义新）→ 隔离该工作流。
- 转移日志：`{seq, node, msg, emitted, at}`，带保留上限，**只做旁路**。换来卡住诊断 + 确定性重放（时间旅行调试器）。保留策略未定。

**LLM 侧**

- **内核不认识 LLM**。`arbetslag/agents` 提供 agent/subagent/tool 节点与模型无关的 history 协议；`arbetslag/openai` 提供 effect performer。
- **agent 的循环是图结构**：agent 节点只做"history + 新消息 → 回复或工具调用"；工具是节点，调用沿边出去、结果沿边回来，循环由回边构成。
- **工具 schema 从哪来（未定）**：模板里不复制 schema，但节点之间只能传消息、节点定义只有七个字段。→ 已定（ADR-0013）：agents 包自定工具元数据，构建模板时由 helper 抄进 agent 的 config。

---

## 4. 已被推翻的东西（别重提）

入口节点 / ingress / 渠道 / 传输归属框架 / 内核路由表 `key→workflowId` / 模板里的 `channels:` 与 `per:` / `dispatch` 动词 / `Event` 信封 / `forward` 结构字段 / 「一个工作流只服务一个会话」/ 数组位置即身份 / 从类名派生节点名 / 「模板实例化后仍跟着模板变」/ 「投递队列 + 游标」与「队列即邮箱」（ADR-0005）/ Run 内 `await` effect / 消息上的内核 id / 快照记 `origin` / 「完成」状态与墓碑 / 术语「冻结」（撞「静止」，改成「隔离」）。

两条通用教训：

- **凡"框架理应知道 X"的主张，默认先假设它错**，直到能证明 X 无法由调用方表达。
- **用一个统一接口掩盖平台分叉，比承认分叉更贵**（ADR-0006 的 `list()`）。

---

## 5. spawn + await 子 agent 的参考时序（**尚未核对**，概念 11 会用）

`SubagentTool` 是内置的一份节点定义，把“新增节点 + 接线 + 等结果”打包成一次转移。（此段是对旧时序的草稿，概念 11 会重写；`sends` 里 `port` 与 `type` 是否同一个词尚未定。）

```ts
if (msg.type === "call") {
  const child = `${ctx.id}/w1`;
  return {
    state: { caller: msg.from, callId: msg.body.callId, awaiting: [child] },
    spawn:   [{ id: child, class: "builtin.agent", config: ctx.config.template }],
    connect: [{ from: child, to: ctx.id }],
    sends:   [{ to: child, type: "inbound", body: { query: msg.body.query } }],
    effects: [{ kind: "timer.wait", input: { ms: ctx.config.timeoutMs }, ref: "timeout" }],
  };
}
```

时序：`agent ─call→ SubagentTool ─spawn+sends→ child(agent)` → 子节点自己走 `model.complete` effect 往返 → `sends(final)` 回到 tool → tool 转 `toolResult` 给 caller，同时 `retire: [child]`。

子节点的 effect 往返与父节点的等待互不干扰——父的邮箱空着就是"没事可做"。并行 spawn N 个：`awaiting: [c1..cN]`，回一个减一，减到空才回 caller。超时与结果竞态：两个 handler 都要按 `awaiting` 是否仍包含该 child 做幂等判断。

---

## 6. 现有代码 → 新设计（重写时的对照，全部作废但能省一次考古）

| 现在 | 之后 |
|---|---|
| `Project`：数组位置即身份，`connections: [[i,j]]` | 工作流是持久状态，节点有稳定 id；边按端口命名 |
| `Actor`：Inbox/Outbox 建在 `ts-chan` 上，`process` 是 async | 节点是纯 step；邮箱由内核持久化管理 |
| `messageBox.ts`（Inbox/Outbox） | 出局 |
| `CompletionAgent {api, historyId, allowedTools}` = 查表记录 | agent 是真正有状态的节点，history 是它的私有状态 |
| `Runtime.completionAPIs[]` + `Project.sink()` 查表投递 | 出局；模型调用是 effect |
| `InputAdapter` / `OutputAdapter` 基类 + 用户构造 `WebhookServer` | 出局；图外只有触发器 |
| `Store {set, get}` | 快照 store（load/save-CAS/drop），且 `set` 不原子 → 必须自己保证整份生效 |
| `classNameOf` / `nodeName` 派生名字 | 显式注册名 `defineNode({name: "builtin.agent"})` |
| `toolsState` 字段 | 出局，并入各节点 state schema |
| `UserFunction` | 普通节点（step 包一个纯函数） |
| `node.ts` 隔离 Node-only 依赖 | 思路保留，扩展到 node/worker 两个入口 |
| `tests/smoke.ts` 的 10 条断言 | 估计 4 条可搬（背压、stop 语义、错误传播、序列化往返的精神） |

反面样本坐标：`src/project.ts`（位置即身份）、`src/index.ts`（`Runtime` 查表 + `classNameOf`）、`src/actor.ts` + `src/messageBox.ts`（async Actor）、`src/implementation/input/webhook.ts`（`WebhookServer` 靠构造注入）。

---

## 7. 环境 / 仓库事实

- `apps/telegram-bot/` **只剩 `node_modules`**，源码从未进过 git。残留依赖提示原始意图：`hono` + `@hono/node-server`、`yaml`、`neverthrow`、`date-fns`、`dotenv`。
- 核心包 `packages/arbetslag`：`ts-chan`、`nanoid`、`openai`、`type-fest`、`zod`；biome + tsdown + pnpm workspace。
- `packages/arbetslag/tests/probe.ts`（用户上轮的手工探针）**已不在仓库里**，只有 `tests/smoke.ts`。
- `src/utils.ts` 的 `nanoid(12)`：字母表 `346789ABCDEFGHJKLMNPQRTUWXY`，注释写明"用于内容 key，从不用于节点身份"。
- **平台限额**（决定了后续所有取舍）：
  - SQLite-backed DO：单 key+value ≤ **2 MB**；每对象 10 GB（付费）；input gate 只在存储操作执行期间挡其它事件，**同一个 handler 的 await 之间不挡**；output gate 保证落盘先于出网。
  - KV-backed DO：value ≤ 128 KiB，新项目已不开放。
  - DO alarm：每对象**单槽**，`setAlarm` 覆盖；at-least-once，抛错自动重试（2s 起、最多 6 次）；同对象内不并发；handler wall time 15 分钟。
  - Cloudflare Queues：at-least-once，**明确不保序**。

---

## 8. 逐概念核对进度（主线）

已完成：**1. 模板**、**2. 工作流**、**3. 形状**、**4. 节点**、**5. 边与端口**、**6. 消息**、**7. 效果**、**8. 触发器**、**9. 出口节点**、**10. 静止、Run**、**11. agents 包**、**12. 失败与隔离**（ADR-0002 / 0007 / 0008 / 0009 / 0010 / 0011 / 0012 / 0013 / 0014 / 0015）：

- 隔离（ADR-0015）：内核唯一的失败出口，整份隔离；触发条件为封闭清单；载荷 `{code, node?, detail, at}`，`code` 封闭枚举（字段名不钉死）；只有 `release(id)` 一个解除动作，修复靠改部署；隔离期间外部投递被拒、效果回执接受但不 run。

- Run（ADR-0012）：跨邮箱按入队全局序号取最早的消息，确定；有步数预算，耗尽不隔离，落盘后可续跑；`awaiting` 与 `@await.broken` 取消，静止≠死锁不可判定的天花板不变。

- agents 包（ADR-0013 / 0014，已完成）：agent 是节点定义，history 是私有状态，循环=回边；端口是 config 的纯函数（节点定义第七字段 `ports(config)`）；工具 schema 由 agents 包 helper 在构建模板时抄进 config；并行工具调用靠 state 里的 `pendingCallIds`。**模板里 `tools` 与 `edges` 重复写法的语法糖：只做记录，留给实现。** subagent 是普通节点（两条结束路径幂等，超时用 `timer.wait`）；第一版不压缩 history，撞上限即隔离；history 格式由 agents 包定义，`model.complete` 的厂商参数在 `input.params`。
- 出口节点（ADR-0011）：不是概念，只是会交出某类效果的普通节点；效果种类由宿主注册（名字、input schema、回执 body schema），非法效果→隔离；未识别的消息类别由 step 显式处理，内核不兜底丢弃。

- 触发器（ADR-0010；ADR-0001 的相关表述已改写）：形状里一条从图外指向节点的入边 `{id, kind, config, to, type}`；来源是快照不是模板；图可增删；回收节点连带删除；内核认 kind 的名字与 config schema、不认行为；声明不合法→隔离，合法但起不来→不隔离，宿主对账；没有"切分"概念，一个 chat 一份工作流由持有触发器的总机工作流经跨工作流投递 effect 实现。

- 形状：边是 `{from, to, port?}` 三元组；端口在发送侧、单值、扇出要靠节点；id 由创建者命名、活节点内唯一、回收后不禁止复用；任何节点都能改图，回收连带删边；没有父子关系、没有 supervisor；投递无路则丢弃并记录，改图非法则隔离。
- 节点定义（本轮改写了 ADR-0007）：能力清单收到七个字段（`ports(config)` 为后补；`describe` 出局）；注册表只放最新一版、快照节点记录带 `(name, version)`；`migrate(state, fromVersion)` 单函数、只向前；state 每次转移后与载入时都校验；“纯”只指无副作用，可以读时钟与随机。
- 消息（ADR-0009）：信封三个字段，目标不在信封上、没有内核 id；端口名就是消息的类别；入站形状归应用（共享 schema、节点自己收窄）；`@` 前缀归内核。

**12 个概念已全部核对完毕**，等待用户确认共识。

---

## 9. 未定 / 已知脆弱

**概念 2 留下的挂起项**（用户明确要求先不定）：

1. **快照体积上限的具体数值**（原则已定：硬上限 + 显式隔离，绝不截断；`inspect` 分报 state/inbox/effects 三处字节）。等有可动原型。
2. ~~出口 effect 是否等结果~~ → 已定：一定有回执，出口型也是（ADR-0008）。
3. **`schema` / `quarantine` 外壳的具体形态**：用户要求"不要钉死"，后续概念可能推翻。
4. ~~隔离原因的结构化载荷~~ → 已定（ADR-0015）。
5. ~~`awaiting` 的具体表示~~ → 已取消（ADR-0012）。

**更早的未定**：

6. 包的物理布局与命名。
7. 模板里边与端口的具体写法（概念 5）。
8. Workers 映射：一个工作流一个 DO？DO alarm 怎么驱动 Run？一个 DO 能承载多少节点状态？（ADR-0006 已经假设"没有全局 list"）
9. 转移日志的保留策略与截断阈值。
10. 观察面形态：CLI `inspect`？HTTP 端点？有没有 UI。
11. 在飞 effect 的取消协议。
12. 成本/用量记账放哪一层。
13. ~~多版本节点类并存~~ → 已定不考虑：注册表只放当前部署那一版，版本落后靠 `migrate`，版本超前则隔离（ADR-0007）。
14. 现有 `smoke.ts` 哪些断言可原样搬。
15. **`transition` 的字段清单**：`state` / `sends` / `effects` / 形状改动（新增/接线/回收，字段名未定）/ `awaiting` 各自是否必要、形状如何。**现在不落 `CONTEXT.md`**。
16. ~~端口单值/多值~~ → 已定单值（ADR-0002）；扇出要写节点，fork 类语义（Rx 式流处理）是未来的节点定义。
17. ~~未接线端口被发送~~ → 已定丢弃，并在转移日志里记一条。
18. **工具 schema 从哪来** → 概念 11（`describe()` 已删除，见 §3）。

**已知脆弱**：

- **静止 ≠ 死锁不可判定**。只能靠 awaiting + 超时 + 观测让它"看得见"。
- **每处推进都是全量快照写**（一条消息在示例图上约 6 次）。快照越大越贵。
- **跨投递方无全序**。同一会话要保序只能由投递方串行。
- **部署重叠 → `Conflict` 风暴 + 个别 Run 重跑**（可能重复出图，靠 `effectId` 吸收）。

---

## 10. 用户的协作方式（最省时间的部分）

- **一轮一个概念，一轮一组问题，每条给推荐答案。** 不要铺开多个概念，不要给"如果你选 A 那么 B"的条件问题。
- **概念还没进 `CONTEXT.md` 时，用之前先显式对齐。** 别拿"我理解的 X"直接往下推：先把这个词在我嘴里的意思说成一句话，等他点头或纠正，再继续。本轮案底两笔：把"等外部按 id 投递"当成孤立节点的常态（实际是"等别的节点改图把它接上"）；用"父子节点"描述运行时新增的节点（一起被驳回）。
- **他会逐条反驳，且反驳往往是对的。** 已推翻过的包括：模板跟着实例变、渠道算路由键、框架拥有入口、"必须"式的契约措辞。
- **抽象论证他吃不进，例子他能吃。** 推荐必须给 YAML / TS / 时序 / 表格的具体样式。
- **他会自己推翻自己上一轮的结论**（先问"入口要不要特殊"，下一轮说"入口根本不是节点"）。别为了连贯守着旧结论。
- **术语之争要认真对待**：先承认论据错误，再给新论据或直接改。改名同步 `CONTEXT.md` 与 ADR。他否决过「冻结」（撞「静止」），接受「隔离」；不要提议「挂起」（撞协程挂起）、「停牌」（语境太窄）。
- **措辞要轻**：「必须」会被驳回，写「强烈推荐」。
- **还没 grill 过的细节不要钉死**：ADR 里只写决定与理由，别把字段形状写死成"现状即规范"。
- 说"先别写文件"就是字面意思——只写他点过头的文档。

---

## 11. Suggested skills

- **`grill-with-docs`**——本阶段主技能。逐概念核对就是它的 round loop。盲点：它假设"问事实是你的活"，而本项目的"事实"在用户脑子里，代码是反面样本；平台事实（DO/Queues 限额）确实要自己去查。
- **`prototype`**——遇到纸上说不清的点（快照体积上限、DO alarm 驱动 Run、流式易失转移的手感）用。**先问**，因为动代码需要许可。
- **`handoff`**——每轮核对完优先更新 `CONTEXT.md`/ADR，不要造新文档类型。
