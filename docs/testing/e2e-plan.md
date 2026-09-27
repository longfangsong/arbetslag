# E2E 测试方案（仅 mock LLM + 外部 API）

## 0. 一条硬规则

**只有两处允许 mock：AIProvider（LLM）与出网 HTTP（外部 API）。其余全部跑真实实现。**

真实跑的部分：Orchestrator、EventBus、Agent 状态机、Compact（两级）、Repository（真文件系统临时目录）、工具实现、Input Adopter、Output Router、序列化/断点恢复。

这条规则用 msw 的 `onUnhandledRequest: "error"` 变成可执行断言：任何未登记的出网请求直接让测试失败。这样"只 mock 这两层"不是口头约定，而是 CI 里可验证的性质。

## 1. Mock 白名单（当前全部出网点）

| 位置 | 性质 | mock 方式 |
|---|---|---|
| `implementation/aiProvider/openai.ts` | LLM | T1：`FakeLLM`（脚本化 AIProvider）；T3：msw handler 测 wire mapping |
| `implementation/inputAdopter/telegram.ts` | 外部 API（`getFile` / `file/bot…`） | msw handler（无 apiBase seam，只能挂在真实 host） |
| `implementation/outputRouter/telegram.ts` | 外部 API（`sendRichMessage`） | msw handler + 调用记录（构造器有 `apiBase`，可指向 `https://telegram.test`） |
| `implementation/tool/http.ts` | 外部 API | msw wildcard handler |
| `implementation/tool/webSearch.ts` | 外部 API（SearXNG） | msw handler；测试里 `rateLimitMinMs/MaxMs = 0` |
| `implementation/tool/cron/*` | 外部 API（cron-job.org） | msw handler |
| `implementation/tool/telegram.ts` | 外部 API（sendSticker 等） | msw handler |
| `implementation/tool/fetchWebPage.ts` | 外部 API + 浏览器进程 | 浏览器无法被 fetch 拦截 → `vi.mock("playwright")`（或把该工具排除在 E2E 之外） |
| `implementation/tool/getTime.ts` | 时钟 | `vi.setSystemTime` + `TZ=UTC` |

不 mock：`NodeFileSystem`（用临时目录，断点恢复是 E2E 契约的一部分）、EventBus、Agent、Compact、各 Repository。

## 2. 三个测试层

### T1 框架 E2E（主战场）

入口 = `OrchestratorDeps` + `orchestrator.push(event)` → `stepUntilIdle()`，出口 = Output Router 发出的调用 + 落盘状态。

```
Event → EventBus → Orchestrator.dispatch → Agent 状态机 → 工具（真 fs / mock 网络）
      → LLM（FakeLLM）→ Compact → Output Router（mock 网络）→ 落盘
```

场景必须让**真实组件**产生行为（blocked_on_tool 的重排、compaction 触发、断点恢复），FakeLLM 只负责"吐出一段固定台词"——它不能思考，否则测的是测试脚本本身。

### T2 App E2E（可选，需要小重构）

入口 = `POST /webhook`（Telegram update JSON）→ `TelegramInputAdopter` → `UpdateBatcher` → orchestrator → Telegram send。
覆盖 batcher 防抖、`/compact` 命令解析、`[[sticker:]]`/`[[pin:]]` token、HMAC 校验。

前提：`apps/telegram-bot/telegram-bot.ts` 是脚本（import 时读 env、起服务），不可测。要拆成 `createApp(deps)` + `main.ts`，测试用 `app.request("/webhook", ...)`（不需要真起 HTTP server）。

### T3 Provider 契约测试（小）

只测 `OpenAIProvider` 自身的 mapping：content parts → `image_url`、`zodResponseFormat`、`supportsImages` 被拒绝后重试。这一层用 msw 假 OpenAI 端点，是"LLM 在 HTTP 层被 mock"的唯一例外。

## 3. Harness

```ts
// tests/e2e/support/fake-llm.ts（已实现）
// Map<regex, behaviour>，按插入顺序取第一个命中；value 可以是数组，同一规则每次
// 调用消费一项，于是同一轮能先"调工具"再"回答"。
// 匹配文本 = 最后一个 user 条目的文本（图片计作 `[N image(s)]`），所以 compaction
// 的摘要请求用 /# New conversation history is to be summarized/ 命中。
// tool_call 的 id 由 FakeLLM 生成（call1, call2…），规则里不写 id，快照稳定。
// 无匹配 / 规则耗尽 → 返回 err，测试立刻响。
// usage 用 estimateHistoryTokens(history) 兜底，保留 ADR-0001 的 metering 触发点。
// 需要按 tool result 分支时用函数 behaviour：(req) => ({ content: "..." })。
//
// 用法：
//   new FakeLLM(new Map([
//     [/帮我搜/, [
//       { tool_calls: [{ tool_name: "web_search", arguments: { query: "cats" } }] },
//       { content: "找到 3 条结果" },
//     ]],
//     [/^# New conversation history is to be summarized/, { content: "用户此前要求搜 cats" }],
//   ]));
```

```ts
// tests/e2e/support/fake-http.ts
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export interface ApiCall { method: string; url: string; body?: unknown }

export class FakeApi {
  readonly calls: Array<ApiCall> = [];

  private record(method: string, url: string, body?: unknown) {
    this.calls.push({ method, url, body });
  }

  listen() {
    const server = setupServer(
      // Telegram output（mock host）
      http.post("https://telegram.test/bot:token/sendRichMessage", async ({ request, url }) => {
        this.record("POST", url.pathname, await request.json());
        return HttpResponse.json({ ok: true });
      }),
      // Telegram input adopter：没有 apiBase seam，只能匹配真实 host
      http.get("https://api.telegram.org/bot:token/getFile", ({ url }) => {
        this.record("GET", url.pathname);
        return HttpResponse.json({ ok: true, result: { file_path: "photo.jpg", mime_type: "image/jpeg" } });
      }),
      // SearXNG、cron-job.org、任意 http_request：按需注册
      http.all("https://cron.test/*", async ({ request, url }) => {
        this.record(request.method, url.pathname, await request.json().catch(() => undefined));
        return HttpResponse.json({ jobId: 1234 });
      }),
      http.all("https://example.test/*", async ({ request, url }) => {
        this.record(request.method, url.pathname, await request.json().catch(() => undefined));
        return HttpResponse.json({ ok: true });
      }),
    );
    // 硬规则的可执行形式：未登记的出网 = 测试失败
    server.listen({ onUnhandledRequest: () => "error" });
    return server;
  }
}
```

```ts
// tests/e2e/support/harness.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Orchestrator, NodeFileSystem, FileSystemAgentRepository,
  FileSystemTemplateRepository, FileSystemToolStateRepository,
  InMemoryToolRepository, InMemoryAIProviderRepository, Telegram,
  type OrchestratorDeps, type Template, type Tool,
} from "arbetslag";
import { FakeLLM, type Behavior } from "./fake-llm";
import { FakeApi } from "./fake-http";

export async function createHarness(o: {
  rules: Map<RegExp, Behavior | Array<Behavior>>;
  templates: Array<Template>;
  tools: Array<Tool<unknown, unknown, unknown>>;
}) {
  const dir = await mkdtemp(join(tmpdir(), "arbetslag-e2e-"));
  const fs = new NodeFileSystem(dir);
  const llm = new FakeLLM(o.rules);
  const api = new FakeApi();
  const server = api.listen();

  const deps: OrchestratorDeps = {
    fileSystem: fs,
    agentRepository: await FileSystemAgentRepository.create(fs, "agents/"),
    templateRepository: await FileSystemTemplateRepository.create(fs, "config/templates/"),
    toolRepository: new InMemoryToolRepository(o.tools),
    toolState: new FileSystemToolStateRepository(fs, "tool_state/"),
    aiProviderRepository: new InMemoryAIProviderRepository([llm]),
    outputRouter: new Telegram("test-token", "12345", "https://telegram.test"),
  };
  const orchestrator = new Orchestrator(deps);

  return {
    dir, fs, llm, api, orchestrator,
    close: async () => { server.close(); await rm(dir, { recursive: true, force: true }); },
  };
}
```

## 4. 断言模型（三个观察点）

1. **LLM 看到了什么** — `llm.requests[i]`：system prompt 组装（含 meta prompt）、`<reply_to>` 块、`<api_callback>` 渲染、tool 列表、outputSchema、compaction 后的 `history[0]`。这是 E2E 最有价值的断言，快照最容易被 prompt 漂移破坏。
2. **系统对世界做了什么** — `api.calls`：Telegram send 的内容、cron 创建、http 请求。
3. **落盘状态** — `agents/<id>.json`、`tool_state/`、工具写的文件。

快照必须做 id 归一化（`nanoid` 不可控）：在 e2e setup 里 `vi.mock("nanoid", () => ({ nanoid: (n = 10) => `id${counter++}` }))`，这样快照稳定且可读；不要为此在生产代码里加 seam。

## 5. 场景清单

### P0（骨架，先做这 6 个）

| # | 场景 | 关键断言 |
|---|---|---|
| 1 | 普通消息 → 回复 | 1 次 LLM 请求，`history[0]` = template system prompt + meta prompt；1 次 sendRichMessage |
| 2 | 工具往返：assistant 返回 `tool_call` → 工具真执行 → tool response → 第二次 LLM | history 角色序列 `system,user,assistant,tool,assistant`；工具真写的文件存在；tool response content 是 JSON |
| 3 | 一次返回多个 tool_call（`waitingForToolCallCount > 0`），tool response 乱序到达 | Agent 把 `tool_call_response` 重排到队首；未完成前不请求 completion |
| 4 | Input Adopter：reply/quote（长文本截断）、sticker、photo（`getFile` + 文件下载走 mock）、无 token 时纯图片消息被丢弃 | `[sender]: ` 签名 + `<reply_to>` 块 + image part 相邻 |
| 5 | Compaction 两级：(a) rule-level 达标 → **不产生** LLM 摘要调用；(b) 不达标 → LLM-level 摘要合并进 `history[0]`，meta prompt 仍在，compact notice 被 route | `llm.requests.length`、`history[0]` 快照、`SUMMARY_MARKER`、round 边界不被切断 |
| 6 | 断点恢复（serverless 契约）：跑到中途停止 → 用同一 workspace 新建 Orchestrator → 继续到 idle | 恢复前后状态一致；`eventQueue`/`lastPromptTokens`/`chatMap` 从盘上读回 |

### P1

| # | 场景 | 关键断言 |
|---|---|---|
| 7 | `spawn` 子 agent → `agent_message` 路由回 entry agent | 两个 agent 各自 history 隔离；meta prompt 让 LLM 看到 `<from_agent_id>` |
| 8 | cron：`create_cron`（mock API）→ 回调经 `/cron` 路由（HMAC 校验通过/失败）→ `api_callback` 进 history → `delete_cron` | HMAC 不匹配返回 401；`<api_name>`/`<id>` 渲染 |
| 9 | `web_search` 走 mock SearXNG | 结果形状、`maxResults`、错误分支（mock 返回 500 → Result.err） |
| 10 | `http_request` 工具 + 响应落盘 | `savedTo` 文件内容 |
| 11 | 错误路径：未知 tool（content = `Tool not found`）、未知 provider（throw）、`stepUntilIdle(maxIterations)` 保护 | 状态已 checkpoint（盘上有文件） |
| 12 | 多 chat 隔离 | 每个 chat 一个 entry agent；新 chat 用 default template |
| 13 | `outputSchema`（`z.fromJSONSchema`）路径 | fake 收到 schema；结构化 content 被 route |
| 14 | 模板静态性：模板在运行中被 `add` 改写后，已存在 agent 仍用原模板 | `agent.template` 不变 |

### P2（有价值但不阻塞）

| # | 场景 | 备注 |
|---|---|---|
| 15 | `OpenAIProvider` wire mapping（T3） | image parts、`response_format`、被拒后 `supportsImages=false` 重试 |
| 16 | `fetchWebPage`：X 链接改写到 fxtwitter、JSON 抽取 | 浏览器用 `vi.mock("playwright")` |
| 17 | memory 工具 / ontology 工具（等模块回来再补） | |
| 18 | App 层：batcher 防抖、per-chat 隔离、`/compact` 命令解析、sticker/pin token、TEST_MODE dry-run | `batcher.check.ts` 的 console.assert 应迁成 Vitest |

## 6. 确定性规则

- `TZ=UTC`（vitest global setup 里设 `process.env.TZ`），否则 `get_time` 快照跨机器不稳定。
- `vi.mock("nanoid")` 用计数器；快照里不出现随机 id。
- 时钟：`vi.useFakeTimers()` + `vi.setSystemTime(固定)`；fixture 的 update 永远带 `date`，这样 `send_time` 不依赖 `Date.now()`。
- `WebSearch` 的 `lastSearchAt` 是**进程全局** → 跨文件测试污染。测试里传 `rateLimitMinMs = rateLimitMaxMs = 0`，或给模块加 reset。
- 每个测试文件用独立临时目录，跑完删除；测试内不读任何真实凭据 env。
- `maxIterations` 传小值（如 50），让失控循环立刻暴露。
- `DEBUG` 环境变量在 CI 关掉（`debug` 输出会污染快照）。

## 7. 需要动生产代码的地方（最小集）

1. `src/index.ts` 的 `@/implementation/tool/ontology` 不存在 —— 现在 `pnpm --filter arbetslag type-check` 就是失败的，从包入口 import 也会炸。E2E 前必须修。
2. `ArbetslagConfig` 加可选 `aiProvider?: AIProvider` 和 `outputRouter?: OutputRouter`（两个字段，让公共入口 `processEvent` 本身可测）。这是唯一必要的 seam 新增。
3. `apps/telegram-bot/telegram-bot.ts` 拆 `createApp(deps)` + `main.ts`（只在决定做 T2 时）。
4. `WebSearch` 的进程全局 rate-limit 状态改为实例字段或加 `reset()`（测试污染，不是设计偏好）。

其它一律不加 seam —— `fetch` 用 msw 在网络层拦，不需要改构造器。

## 8. 落地顺序

1. 修 ontology + 加 `test` 相关 vitest 配置（`include: ["tests/**/*.test.ts"]`, `environment: "node"`）。
2. 装 `msw`，写 `support/`（FakeLLM、FakeApi、harness、id 归一化、`onUnhandledRequest: "error"`）。
3. P0 场景 1–2 跑通 —— 确认"只 mock 两层"这条规则真能守住（故意让某场景打真网络，看它失败）。
4. 补 P0 剩余 4 个（尤其断点恢复和 compaction 两级）。
5. P1，然后 CI：`pnpm -r test` 加 job，快照入库。

## 9. 明确不做

- 不测真 LLM（可选的 golden 测试另开，不进 CI）。
- 不 mock 文件系统。
- 不为测试给 `fetch` / `nanoid` / 时钟加生产 seam。
