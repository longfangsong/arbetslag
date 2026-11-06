import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DeploymentError, prepareDeployment, startDeployment } from "../src/index.ts";
import { fakeOpenAI, fakeTelegram } from "./fakes.ts";

/** 验收用的就是示例部署自己的模板目录：示例因此一定能跑。 */
const EXAMPLE_TEMPLATES = fileURLToPath(new URL("../../../examples/telegram-config/templates", import.meta.url));

async function workspace(config: string, templates: Record<string, string> | "example" = {}) {
	const dir = await mkdtemp(join(tmpdir(), "arbetslag-deploy-"));
	if (templates === "example") {
		await cp(EXAMPLE_TEMPLATES, join(dir, "templates"), { recursive: true });
	} else {
		await mkdir(join(dir, "templates"));
		for (const [file, text] of Object.entries(templates)) await writeFile(join(dir, "templates", file), text);
	}
	await writeFile(join(dir, "arbetslag.yaml"), config);
	return { dir, file: join(dir, "arbetslag.yaml") };
}

async function issuesOf(file: string, env: NodeJS.ProcessEnv = {}): Promise<readonly string[]> {
	try {
		await prepareDeployment(file, env);
	} catch (error) {
		if (error instanceof DeploymentError) return error.issues;
		throw error;
	}
	return [];
}

async function until(check: () => boolean, ms = 5000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("a missing env variable and a telegram listener without a token are both reported, and nothing starts", async () => {
	const { file } = await workspace(`
store: ./bot.sqlite
providers:
  main: { kind: openai, apiKey: "\${MISSING_KEY}" }
listeners:
  - { id: bot, kind: telegram }
`);
	assert.deepEqual(await issuesOf(file), ["environment variable MISSING_KEY is not set"]);
	assert.deepEqual(await issuesOf(file, { MISSING_KEY: "k" }), ["listeners.bot: a telegram listener needs a token"]);
});

test("unknown keys, an unknown node, an undeclared param and a name clash in the template directory are all reported", async () => {
	const { file } = await workspace("store: ./bot.sqlite\ntemplates: ./templates\nwhatever: 1\n", {});
	assert.match((await issuesOf(file)).join("\n"), /whatever/);

	const second = await workspace("store: ./bot.sqlite\ntemplates: ./templates\n", {
		"a.yaml": "nodes: { x: { definition: nope, config: null } }",
		"b.json": JSON.stringify({ nodes: { r: { definition: "telegramRelay", config: { listener: "{{who}}", chatId: 1 } } } }),
		"c.json": "{}",
		"c.yaml": "nodes: {}",
	});
	const issues = (await issuesOf(second.file)).join("\n");
	assert.match(issues, /c\.json and c\.yaml are both named "c"/);
	assert.match(issues, /templates\/a: .*definition_unknown/);
	assert.match(issues, /templates\/b: .*param_undeclared.*who/);
});

test("config only: two bots, a switchboard each, per-chat workflows answering through their own bot", async () => {
	const telegram = await fakeTelegram();
	const model = await fakeOpenAI();
	const { dir, file } = await workspace(
		`
store: ./bot.sqlite
templates: ./templates
providers:
  main: { kind: openai, baseURL: "\${MODEL_URL}", apiKey: "\${MODEL_KEY}" }
listeners:
  - { id: bot-a, kind: telegram, token: "\${TOKEN_A}", apiBase: "\${TG}", config: { pollSeconds: 1 } }
  - { id: bot-b, kind: telegram, token: "\${TOKEN_B}", apiBase: "\${TG}", config: { pollSeconds: 1 } }
monitor: { port: 0 }
`,
		"example",
	);
	const env = { MODEL_URL: model.url, MODEL_KEY: "sk-secret-key", TOKEN_A: "tok-aaa", TOKEN_B: "tok-bbb", TG: telegram.url };
	const running = await startDeployment(await prepareDeployment(file, env));
	const monitorUrl = running.monitor?.url ?? "";

	try {
		// 部署配置不建工作流：总机经监控、从模板目录、按名字建（ADR-0018）。
		for (const listener of ["bot-a", "bot-b"]) {
			const created = await fetch(`${monitorUrl}/api/workflows`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ template: "switchboard", id: `switchboard:${listener}`, params: { listener } }),
			});
			assert.equal(created.status, 201);
		}

		telegram.say("tok-aaa", 1, "hi from 1");
		telegram.say("tok-aaa", 2, "hi from 2");
		telegram.say("tok-bbb", 1, "hi b");
		await until(() => telegram.sent.length === 3);
		telegram.say("tok-aaa", 1, "again");
		await until(() => telegram.sent.length === 4);
		await running.host.idle();

		assert.deepEqual(
			[...telegram.sent].sort((a, b) => a.text.localeCompare(b.text)),
			[
				{ token: "tok-aaa", chatId: 1, text: "echo: again" },
				{ token: "tok-bbb", chatId: 1, text: "echo: hi b" },
				{ token: "tok-aaa", chatId: 1, text: "echo: hi from 1" },
				{ token: "tok-aaa", chatId: 2, text: "echo: hi from 2" },
			],
		);
		assert.deepEqual(await running.store.ids(), [
			"chat:bot-a:1",
			"chat:bot-a:2",
			"chat:bot-b:1",
			"switchboard:bot-a",
			"switchboard:bot-b",
		]);
		const board = await running.host.snapshot("switchboard:bot-a");
		assert.equal(
			(board?.graph.nodeStates.switchboard?.state as { spawned: number }).spawned,
			2,
			"the second message to chat 1 went straight to its own workflow",
		);
	} finally {
		await running.stop();
		await telegram.close();
		await model.close();
	}

	// 密钥不进快照：整个存储里搜不到任何 token 或 key。
	const files = (await readdir(dir)).filter((name) => name.startsWith("bot.sqlite"));
	const bytes = Buffer.concat(await Promise.all(files.map((name) => readFile(join(dir, name)))));
	for (const secret of ["tok-aaa", "tok-bbb", "sk-secret-key"]) {
		assert.equal(bytes.includes(secret), false, `${secret} leaked into the store`);
	}
});
