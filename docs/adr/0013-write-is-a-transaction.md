# 写入是一次事务，不是一次 CAS

一份工作流的并发控制归存储，不归内核。`SnapshotStore` 因此只有 `load` / `create` / `commit` / `drop`：**没有版本号、没有冲突类型、没有重试循环。** `commit(id, change)` 把「读快照 → 变换 → 写回」整段放进存储自己的临界区，`change` 必须是同步纯函数。

**Status**: accepted

## 决定

- **`SnapshotStore` 的形状**
  ```ts
  load(id): Promise<Snapshot | undefined>
  create(id, snapshot): Promise<void>          // 已存在 → WorkflowExists
  commit<T>(id, change: (snapshot: Snapshot) => CommitResult<T>): Promise<T>
  drop(id): Promise<void>
  ```
  `commit` 的回调**同步**（返回的不是 promise）：临界区绝不许横跨外部调用或 `await`。
  返回 `{ snapshot: undefined }` 表示这次没有改动，存储不必落盘。
- **没有 `Revision`、没有 `Conflict`、没有重试循环。** 「同一条记录的两次推进不会交错」由存储保证，不由调用方靠版本号发现。
- **Node 宿主：`BEGIN IMMEDIATE` 包住回调。**
  ```ts
  db.exec("BEGIN IMMEDIATE");
  const current = parse(selectById.get(id));      // 锁已在手
  const result = change(current);                  // 同步、纯
  if (result.snapshot) updateById.run(JSON.stringify(result.snapshot), id);
  db.exec("COMMIT");
  ```
  加锁发生在**读之前**（`IMMEDIATE` 而不是默认的 `DEFERRED`），所以不存在"读完才发现拿不到锁"。
- **`create` 还是单独一个方法**，不是 `commit` 的 `undefined` 分支：创建一次工作流和推进一份工作流是两件事，各自有一个明确的失败（`WorkflowExists` / `WorkflowNotFound`）。
- **内核零依赖版本概念。** `run` / `deliver` / `settle` / `createWorkflow` 都在 `commit` 回调里做它们本来就是纯的那部分。
- **事务只管"不丢更新"**；"同一个效果不被交出两次"是另一件事，靠单激活（ADR-0014）。

## 为什么

- **CAS 与事务保护的是同一个区间**：「读快照、跑 step、写回」这段期间没人动过它。CAS 靠拒绝（乐观），事务靠等待（悲观）。让存储从读一直锁到写，CAS 要防的问题就不存在了；两者选一个，另一个就是纯开销。
- **并发度在这里不值钱。** 目标形态是一个进程 + 一份文件（或一个 Durable Object），冲突本来就少；为"不同工作流能交替推进"付一整套乐观并发控制的复杂度不划算。串行的代价是吞吐上限，收益是**少四个概念**：版本号、冲突、重试、作废。"外部投递要不要重试""冲突后哪些推进作废""日志会不会留下被作废的记录"这些问题都不存在。
- **真正必须留在临界区外的是外部调用**，那本来就由 `inFlight` 管（ADR-0006），与并发控制无关。
- **一条纪律变成了类型。** "事务里绝不许放 Performer"不是一句约定：`change` 返回不了 promise，写不进去。

## 代价（接受）

- **SQLite 一把全库写锁**：同一份库里，**所有**工作流一次只能推一个。`step` 是毫秒级纯函数，所以这是吞吐上限，不是延迟问题。
- **`busy_timeout` 与最慢的一次 `commit` 耦合**：回调跑得比它久，别的连接就会收到 `SQLITE_BUSY` 而不是安静地等。这个数要大于"预算跑满的长 Run"，否则是假超时。
- **远端存储变贵**：Postgres 适配器要持一条连接 + 一行锁跨一次推进（`SELECT … FOR UPDATE`）。可行，但不像"一条条件 UPDATE"那样便宜。这也是"必须同步"这条约束的由来。
- **没有撞车的诊断信号**：并发推进只是无声的排队。

## Retired designs（不要重提）

- **`Revision` / `Conflict` / `save(id, snapshot, expected)` / `MAX_ATTEMPTS` / `update()` 重试循环。**
- **"CAS 是接口语义，成本由实现决定"**：它把并发控制留在内核契约里，而内核根本不需要认识"版本"。
- **「临时文件 + rename + 整份读回比对」当作 CAS**（那是文件系统时代的做法，且它并不构成 CAS）。
- **应用层的跨进程锁**：锁文件 / 租约 / 按 id 分区单写者。它做的事和 `BEGIN IMMEDIATE` 一样，崩溃处理更差。
- **状态 / 邮箱 / outbox 分表**：跨记录事务解决的是不存在的多写者问题，代价是赔掉「整份快照可 dump / diff / 断言」。
- **把事务包住 Performer**：类型上写不出来，不要再想。
- **`Store.list()`**：`ids()` 在 Node 宿主的**具体** store 上，不在内核接口上（ADR-0003）。

## 反转条件

- 如果 `step` 变慢（秒级）或存储变远（网络往返），悲观锁的代价会盖过它省下的复杂度：那时回到乐观——但**做在 store 内部**（`change` 是纯的，所以可以重试），`SnapshotStore` 的四个方法一个字不改。
- 如果某个目标平台做不到"持锁跨一次纯计算"（例如 D1：没有交互式事务），它的 store 就在内部做乐观重试，内核不知情。
- 如果"所有工作流串行"成为真实瓶颈：先按 id 分库（多个文件 / 每个工作流一个 DO），不要分表。

## 验收

1. `packages/kernel/src/snapshotStore.ts` 只有四个方法。
2. `packages/hosts/node/src/sqliteStore.ts`：`commit` 是一条 `BEGIN IMMEDIATE … COMMIT`，`change` 在锁内同步跑。
3. `packages/hosts/node/tests/sqliteStore.test.ts`：
   - 「two connections on one file both land」——两个连接各推一步，**两次都在**（不是"一个赢一个输"）。
   - 「two OS threads bumping the same row lose nothing」——两个真实线程各加 40，结果是 80。
   - 一条 `change` 抛错 → 回滚，记录不变。
