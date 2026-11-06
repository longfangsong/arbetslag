import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

/** 配置有错（ADR-0018）：一次报全，每条指到出错的那一项。启动因此中止。 */
export class DeploymentError extends Error {
	readonly issues: readonly string[];
	constructor(issues: readonly string[]) {
		super(`invalid deployment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
		this.name = "DeploymentError";
		this.issues = issues;
	}
}

const name = z.string().regex(/^[A-Za-z0-9_.-]+$/, "letters, digits, '_', '.', '-'");

/** 一个模型端点：种类、base URL 与 key。工作流的 `llm` 节点按名字选它（ADR-0018）。 */
const providerSchema = z
	.object({
		kind: z.literal("openai"),
		baseURL: z.string().min(1).optional(),
		apiKey: z.string().min(1).optional(),
		/** 每次请求都带上的厂商旋钮；节点的 `params` 盖过它。 */
		params: z.record(z.string(), z.json()).optional(),
	})
	.strict();

/**
 * 一个监听器（ADR-0015）：一个外部事件源一个。`token` 与 `apiBase` 只给 telegram，
 * 它们是部署的东西，不进监听器的 `config`，更不进快照。
 */
const listenerSchema = z
	.object({
		id: name,
		kind: z.string().min(1),
		config: z.record(z.string(), z.json()).default({}),
		token: z.string().min(1).optional(),
		apiBase: z.string().min(1).optional(),
	})
	.strict();

export const deploymentConfigSchema = z
	.object({
		/** SQLite 文件；相对配置文件所在目录。 */
		store: z.string().min(1),
		/** 模板目录；相对配置文件所在目录。省略即没有模板，`workflow.spawn` 一律失败。 */
		templates: z.string().min(1).optional(),
		/** 本地模块的路径；内置模块不用列，全部注册。 */
		modules: z.array(z.string().min(1)).default([]),
		providers: z.record(name, providerSchema).default({}),
		listeners: z.array(listenerSchema).default([]),
		host: z
			.object({
				maxRounds: z.number().int().positive().optional(),
				/** 监听器未就绪时的重试间隔（毫秒）。 */
				retryMs: z.number().int().nonnegative().default(3000),
				performerTimeoutMs: z.number().int().positive().optional(),
				timeouts: z.record(z.string(), z.number().int().positive()).default({}),
			})
			.strict()
			.default({ retryMs: 3000, timeouts: {} }),
		/** 监控（ADR-0017）：创建工作流的唯一入口，默认开在本机 8790；`false` 关掉。 */
		monitor: z
			.union([
				z.literal(false),
				z
					.object({ port: z.number().int().min(0).max(65535).default(8790), hostname: z.string().optional() })
					.strict(),
			])
			.default({ port: 8790 }),
		log: z
			.object({ transitions: z.enum(["stdout", "none"]).default("none") })
			.strict()
			.default({ transitions: "none" }),
	})
	.strict();

export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;

const ENV = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** 把字符串里的 `${NAME}` 换成环境变量；缺的一并报出来。只碰值，不碰键。 */
function interpolate(value: unknown, env: NodeJS.ProcessEnv, missing: Set<string>): unknown {
	if (typeof value === "string") {
		return value.replace(ENV, (match, variable: string) => {
			const found = env[variable];
			if (found === undefined || found === "") {
				missing.add(variable);
				return match;
			}
			return found;
		});
	}
	if (Array.isArray(value)) return value.map((item) => interpolate(item, env, missing));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, interpolate(inner, env, missing)]));
	}
	return value;
}

const where = (path: readonly PropertyKey[]): string => (path.length === 0 ? "(root)" : path.map(String).join("."));

/** 读、填环境变量、校验；路径都换成绝对路径。有错抛 `DeploymentError`。 */
export async function loadConfig(
	file: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<{ config: DeploymentConfig; base: string }> {
	const path = resolve(file);
	const base = dirname(path);
	let raw: unknown;
	try {
		raw = parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new DeploymentError([`${path}: ${error instanceof Error ? error.message : String(error)}`]);
	}

	const missing = new Set<string>();
	const filled = interpolate(raw, env, missing);
	const issues = [...missing].map((variable) => `environment variable ${variable} is not set`);

	const parsed = deploymentConfigSchema.safeParse(filled);
	if (!parsed.success) {
		issues.push(...parsed.error.issues.map((issue) => `${where(issue.path)}: ${issue.message}`));
	}
	if (issues.length > 0 || !parsed.success) throw new DeploymentError(issues);

	const config = parsed.data;
	const ids = new Set<string>();
	for (const listener of config.listeners) {
		if (ids.has(listener.id)) issues.push(`listeners: duplicate id ${JSON.stringify(listener.id)}`);
		ids.add(listener.id);
		if (listener.kind === "telegram" && listener.token === undefined) {
			issues.push(`listeners.${listener.id}: a telegram listener needs a token`);
		}
		if (listener.kind !== "telegram" && (listener.token !== undefined || listener.apiBase !== undefined)) {
			issues.push(`listeners.${listener.id}: token and apiBase are only for telegram listeners`);
		}
	}
	if (issues.length > 0) throw new DeploymentError(issues);

	return {
		config: {
			...config,
			store: config.store === ":memory:" ? config.store : resolve(base, config.store),
			...(config.templates === undefined ? {} : { templates: resolve(base, config.templates) }),
			modules: config.modules.map((module) => resolve(base, module)),
		},
		base,
	};
}
