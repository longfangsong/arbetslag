import { pathToFileURL } from "node:url";
import type {
	AnyMatcherDefinition,
	AnyNodeDefinition,
	EffectKindDefinition,
	TriggerKindDefinition,
} from "@arbetslag/kernel";
import {
	type ListenerRuntimes,
	type Performers,
	type TelegramBots,
	createTelegramRuntime,
	createTelegramSender,
	createWebhookRuntime,
	presetMatchers,
	switchboard,
	telegramKind,
	telegramRelay,
	telegramSendKind,
	timerKind,
	timerPerformer,
	webhookKind,
} from "@arbetslag/host-node";
import { type ModelCall, conversation, inbox, llm, modelCompleteKind, modelPerformer, providerCall } from "@arbetslag/llm";
import { createOpenAIModel } from "@arbetslag/llm/openai";
import type { DeploymentConfig } from "./config.ts";

/**
 * 一个模块（ADR-0018）：注册表的一部分，加上它在 Node 宿主里的实现。
 * 本地模块 `export default` 这个形状；内置模块由 `builtinModule` 按部署配置拼出来。
 */
export type DeployModule = {
	nodes?: AnyNodeDefinition[];
	effects?: EffectKindDefinition[];
	triggers?: TriggerKindDefinition[];
	matchers?: AnyMatcherDefinition[];
	performers?: Performers;
	runtimes?: ListenerRuntimes;
};

/** 部署里的 telegram 监听器 → 它们的 token 与网关，按监听器 id。 */
export function telegramBots(config: DeploymentConfig): TelegramBots {
	return Object.fromEntries(
		config.listeners
			.filter((listener) => listener.kind === "telegram" && listener.token !== undefined)
			.map((listener) => [
				listener.id,
				{ token: listener.token as string, ...(listener.apiBase === undefined ? {} : { apiBase: listener.apiBase }) },
			]),
	);
}

/**
 * 内置模块全部注册（ADR-0018）：注册一个种类很便宜，没配 Performer 的效果只报告、不停住。
 * `model.complete` 只在部署里有 provider 时才有 Performer。
 */
export function builtinModule(config: DeploymentConfig): DeployModule {
	const bots = telegramBots(config);
	const providers: Record<string, ModelCall> = Object.fromEntries(
		Object.entries(config.providers).map(([name, provider]) => [
			name,
			createOpenAIModel({
				...(provider.baseURL === undefined ? {} : { baseURL: provider.baseURL }),
				...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
				...(provider.params === undefined ? {} : { params: provider.params }),
			}),
		]),
	);
	return {
		nodes: [llm, conversation, inbox, switchboard, telegramRelay],
		effects: [modelCompleteKind, timerKind, telegramSendKind],
		triggers: [webhookKind, telegramKind],
		matchers: presetMatchers,
		performers: {
			"timer.wait": timerPerformer,
			"telegram.send": createTelegramSender({ bots }),
			...(Object.keys(providers).length === 0 ? {} : { "model.complete": modelPerformer(providerCall(providers)) }),
		},
		runtimes: { webhook: createWebhookRuntime(), telegram: createTelegramRuntime({ bots }) },
	};
}

/** 加载一个本地模块：`export default` 一个 `DeployModule`。 */
export async function loadModule(path: string): Promise<DeployModule> {
	const loaded = (await import(pathToFileURL(path).href)) as { default?: unknown };
	const module = loaded.default;
	if (typeof module !== "object" || module === null) {
		throw new Error(`${path} has no default export of a module`);
	}
	return module as DeployModule;
}

/** 合并模块：同名由注册表报重复（`createRegistry` 抛错）；Performer 与监听器实现重名在这里报。 */
export function mergeModules(modules: readonly DeployModule[]): Required<DeployModule> & { clashes: string[] } {
	const merged: Required<DeployModule> & { clashes: string[] } = {
		nodes: [],
		effects: [],
		triggers: [],
		matchers: [],
		performers: {},
		runtimes: {},
		clashes: [],
	};
	for (const module of modules) {
		merged.nodes.push(...(module.nodes ?? []));
		merged.effects.push(...(module.effects ?? []));
		merged.triggers.push(...(module.triggers ?? []));
		merged.matchers.push(...(module.matchers ?? []));
		for (const [kind, performer] of Object.entries(module.performers ?? {})) {
			if (kind in merged.performers) merged.clashes.push(`performer for ${JSON.stringify(kind)} is given twice`);
			merged.performers = { ...merged.performers, [kind]: performer };
		}
		for (const [kind, runtime] of Object.entries(module.runtimes ?? {})) {
			if (kind in merged.runtimes) merged.clashes.push(`listener runtime ${JSON.stringify(kind)} is given twice`);
			merged.runtimes = { ...merged.runtimes, [kind]: runtime };
		}
	}
	return merged;
}
