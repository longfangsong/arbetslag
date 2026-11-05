# 监控活在激活里，协议与平台无关

监控要回答的是"每份工作流**此刻**怎么样"。在 Node 上，这个答案只有**激活**手里有：比存储新的那份在**工作副本**里，"正在执行"和"未就绪"只存在内存里，存储文件又被激活独占。所以监控和激活跑在同一个进程里，只读激活交给它的东西。浏览器那一侧只认一份与宿主无关的协议：换一个宿主，只重写服务端，前端不变。

**Status**: accepted（2026-11-05）

## 决定

### 监控在激活的进程里

- `@arbetslag/monitor` 的 `createMonitor({ host, port?, hostname?, assets? })` 拿一个 `Host`，开一个 `node:http` 端口，提供 API 和前端的构建产物（React + Vite + shadcn/ui，产物在包里的 `dist/web`）。
- 默认只绑 `127.0.0.1`，**没有鉴权**。要对外暴露，由部署方在前面加反向代理。
- 它读的全部是宿主已有的东西：`store.ids()`、`host.snapshot(id)`（工作副本优先）、`host.executing(id)`、`host.unready()`。它从不推进、不交出效果、不解除停住。

### 宿主多两个方法

- **`host.create(template, { id? })`**：先实例化，再用 `store.spawn` 把快照和它的路由索引行**在一次事务里**落盘，与 `workflow.spawn` 是同一次写（ADR-0015）。id 已存在抛 `WorkflowExists`，模板不合规抛 `InstantiateError`，两种情况都什么也不写。之后重算这份工作流的**未就绪**。监控唯一的写走的就是它。
- **`host.watch(onChange) → unwatch`**：只告诉观察者"变了"，不带快照。
  - `{ scope: "workflow", id }`：串行入口里每做完一项工作（投递、推进、落回执、改图、`resume`、对账、`create`），以及这份工作流正在执行的效果多了或少了。`workflow.spawn` 新建的工作流也报。
  - `{ scope: "unready" }`：**未就绪**那张表变了。
  - 可能多报，不会漏报。回调同步跑在推进的路径上，抛错被吞掉。
- 方法叫 `watch`，不叫 `subscribe`：**订阅**在 `CONTEXT.md` 里已经是边和触发器的术语（ADR-0011、0015）。

### 线上协议（与平台无关）

| 请求 | 响应 |
|---|---|
| `GET /api/workflows` | `Overview`：全部工作流的摘要 + 未就绪表 |
| `GET /api/workflows/:id` | `WorkflowDetail`：摘要、完整快照、正在执行的 `effectId`；没有这份工作流 404 |
| `POST /api/workflows` | `{ template, id? }` → 201 `{ id }`；400 `request_invalid` / `template_invalid`（带全部违规）；409 `workflow_exists` |
| `GET /api/events` | 实时通道：先一条 `overview`，之后增量 `workflow`（一份摘要）、`unready`（整张表） |

- 形状定义在 `packages/monitor/src/protocol.ts`，前端只 import 那里的类型。
- 摘要里的状态由快照推导、不存储，四个互斥：`halted`（**停住**）、`runnable`（**可推进**）、`in_flight`（**等回执**）、`quiescent`（**静止**且没有在飞效果）。
- Node 上实时通道的载体是 SSE。前端把载体包在 `web/src/transport.ts` 一个文件里，事件的形状不随载体变。
- 服务端把同一份工作流的变化合并（默认 100ms）后再推一次摘要；没有连接的客户端时，观察回调直接返回。快照的序列化不放在推进的路径上。
- 详情页收到这份工作流的 `workflow` 事件就重新 `GET` 一次完整快照，不推快照增量。
- 上传只收 JSON，按 `workflowTemplateSchema` 校验，上限 1 MB。

### 新鲜度取决于宿主

- Node：列表和详情都读工作副本，看到的比最近一个检查点新。
- 协议不承诺比"最近一个检查点"更新。将来的宿主只能给到检查点（见下），前端也照样能用。

## 为什么

- **为什么不另起一个进程读 SQLite**：存储以 `locking_mode = EXCLUSIVE` 打开（ADR-0014），第二个进程打不开。就算绕开锁，读到的也只是上一个检查点：ADR-0016 规定只在三个时刻落盘，推进中的状态全在工作副本里。"正在执行"（ADR-0014 的 C2）和"未就绪"（ADR-0015）根本不落盘。
- **为什么 `create` 必须走宿主**：内核的 `createWorkflow(store, …)` 只写快照，不写路由索引。一份带触发器的新工作流，在下一次 `recover` 之前都收不到事件。
- **为什么 `watch` 只带 id**：回调跑在推进的路径上。把快照放进事件，等于每次推进都多一次克隆和序列化，哪怕没人在看。只带 id，观察者自己决定什么时候读、读多少。
- **为什么协议要与平台无关**：ADR 一直把 Workers + Durable Objects + D1 当作另一个目标宿主。在那里，下面这些都不成立：
  - 没有 socket（ADR-0004），服务端只能是一个 Worker 的 `fetch` 路由；
  - 没有全局列表（ADR-0003），列表要靠各 DO 在检查点时写进 D1 的一张摘要投影，而不是逐个唤醒 DO；
  - 没有"整个宿主"的内存，`watch` 要换成活跃的 DO 主动通知一个中心 Monitor DO；
  - 持有 SSE 连接的 DO 一直按墙钟计费，WebSocket 才能用 Hibernation，所以载体会是 WebSocket。
  
  这些全是服务端的事。只要协议的形状不变，前端一行不改。
- **为什么不在代码里先抽一层"监控数据源"接口**：Workers 宿主还不存在，抽出来的接口只能照着想象写。先固定的是协议，接口等第二个实现出现时再从两份实现里提炼。

## 代价（接受）

- **没有鉴权**：只靠绑本机。共享主机上的其他用户能看到全部快照，也能创建工作流。
- **状态显示是推导的**：`watch` 多报时会多推几次相同的摘要；合并窗口之内的中间状态可能看不到（例如一个很快回来的效果，"执行中"一闪而过）。
- **列表是 O(工作流数)**：每次 `overview` 都要逐份 `snapshot`。工作流数到上万时，打开页面会变慢。
- **详情页每次变化都拉整份快照**：大快照（长 history）在频繁推进时流量不小。
- 监控随激活一起死：进程崩溃时页面断线，`EventSource` 自动重连，重连后会收到新的 `overview`。

## 反转条件

- **工作流数大到 `overview` 慢**：给宿主加一份在检查点时维护的摘要投影（与 Workers 上的做法同构），列表读投影。
- **详情页流量成问题**：协议加快照增量，或者把节点 state 改成按需拉取。
- **需要在 UI 上操作**（`resume`、投递）：先加鉴权，再加写接口，写接口一律走 `Host` 的现有动词。
- **Workers 宿主落地**：写它自己的服务端（D1 摘要投影 + Monitor DO + WebSocket），`transport.ts` 换载体。协议不变；如果协议要变，新 ADR。

## Retired designs（不要重提）

- **独立进程直接读 SQLite**：被独占锁挡住，而且看不到工作副本和内存里的状态。
- **用 `createWorkflow(store, …)` 创建**：漏写路由索引。
- **观察事件带快照**：把序列化放进推进的热路径。
- **一层跨宿主的监控数据源接口**：只有一个实现时，它只是 `Host` 的转发。

## 验收

1. **创建即可路由**：`host.start()` 之后 `create` 一份带触发器的工作流，不 `recover`，`emit` 一条事件就能到达。
2. **创建失败什么都不写**：id 已存在 → `WorkflowExists`，路由索引不变；模板不合规 → `InstantiateError`，`ids()` 不变。
3. **观察**：交出一个效果时，观察者看到这份工作流 `executing` 为 1；回执落下后最后一次看到的是 0。观察者抛错不影响推进。
4. **协议**：`POST` 的三种拒绝各有自己的 `code`；SSE 先到 `overview`，效果在执行时推一条 `in_flight` 且 `executing: 1` 的摘要，回来后推 `quiescent`。
5. **默认只绑本机**：不传 `hostname` 时，`url` 是 `http://127.0.0.1:…`。
