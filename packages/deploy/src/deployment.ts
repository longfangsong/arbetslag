import { type Registry, type TransitionLog, createRegistry } from "@arbetslag/kernel";
import {
	type Host,
	type HostOptions,
	type Listener,
	type RecoveryReport,
	type SqliteStore,
	type Templates,
	createHost,
	createSqliteStore,
} from "@arbetslag/host-node";
import { type Monitor, createMonitor } from "@arbetslag/monitor";
import { type DeploymentConfig, DeploymentError, loadConfig } from "./config.ts";
import { type DeployModule, builtinModule, loadModule, mergeModules } from "./modules.ts";
import { checkTemplates, loadTemplates } from "./templates.ts";

/** 校验过、还没启动的部署：启动之前该报的错都在这一步报完（ADR-0018）。 */
export type Deployment = {
	config: DeploymentConfig;
	registry: Registry;
	templates: Templates;
	options: Omit<HostOptions, "store">;
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const stdoutLog: TransitionLog = {
	append: (id, entries) => {
		for (const entry of entries) {
			switch (entry.type) {
				case "transition":
					console.log(`· ${id} ${entry.node} ← ${entry.messageType}`);
					break;
				case "dropped":
					console.log(`· ${id} dropped ${entry.from}.${entry.port} (${entry.reason})`);
					break;
				case "migrated":
					console.log(`· ${id} migrated ${entry.node} v${entry.from} → v${entry.to}`);
					break;
				case "halted":
					console.log(`✖ ${id} halted ${entry.code}: ${entry.detail}`);
					break;
			}
		}
	},
};

/**
 * 读配置、装模块、建注册表、载模板并试实例化。任何一步有错都收进一个 `DeploymentError`：
 * 配置错误在启动时报全，而不是等第一条消息。
 */
export async function prepareDeployment(file: string, env: NodeJS.ProcessEnv = process.env): Promise<Deployment> {
	const { config } = await loadConfig(file, env);
	const issues: string[] = [];

	const local: DeployModule[] = [];
	for (const path of config.modules) {
		try {
			local.push(await loadModule(path));
		} catch (error) {
			issues.push(`modules: ${describe(error)}`);
		}
	}
	const modules = mergeModules([builtinModule(config), ...local]);
	issues.push(...modules.clashes.map((clash) => `modules: ${clash}`));

	let registry: Registry | undefined;
	try {
		registry = createRegistry(modules);
	} catch (error) {
		issues.push(`modules: ${describe(error)}`);
	}

	for (const listener of config.listeners) {
		if (modules.runtimes[listener.kind] === undefined) {
			issues.push(`listeners.${listener.id}: no listener runtime for kind ${JSON.stringify(listener.kind)}`);
		}
	}

	let templates: Templates = {};
	if (config.templates !== undefined) {
		const loaded = await loadTemplates(config.templates);
		templates = loaded.templates;
		issues.push(...loaded.issues);
	}
	if (registry !== undefined) issues.push(...checkTemplates(registry, templates));

	if (issues.length > 0 || registry === undefined) throw new DeploymentError(issues);

	const listeners: Listener[] = config.listeners.map(({ id, kind, config: listenerConfig }) => ({
		id,
		kind,
		config: listenerConfig,
	}));
	return {
		config,
		registry,
		templates,
		options: {
			registry,
			templates,
			performers: modules.performers,
			listeners,
			runtimes: modules.runtimes,
			retryMs: config.host.retryMs,
			timeouts: config.host.timeouts,
			...(config.host.maxRounds === undefined ? {} : { maxRounds: config.host.maxRounds }),
			...(config.host.performerTimeoutMs === undefined ? {} : { performerTimeoutMs: config.host.performerTimeoutMs }),
			...(config.log.transitions === "stdout" ? { log: stdoutLog } : {}),
			onUnready: (info) =>
				console.log(
					`! unready ${info.scope === "listener" ? info.listener : `${info.workflowId}/${info.trigger}`}: ${info.reason}`,
				),
		},
	};
}

export type Running = {
	host: Host;
	store: SqliteStore;
	monitor?: Monitor;
	recovered: RecoveryReport;
	/** 关监听器、关监控、关存储。不等在飞的效果：它们留在快照里，下一个激活再交出去（ADR-0014）。 */
	stop(): Promise<void>;
};

/** 按一份校验过的部署启动一个激活：打开存储、恢复扫描、打开监听器、开监控。 */
export async function startDeployment(deployment: Deployment): Promise<Running> {
	const store = createSqliteStore({ file: deployment.config.store });
	const host = createHost({ ...deployment.options, store });
	const recovered = await host.start();
	const { monitor: monitorConfig } = deployment.config;
	let monitor: Monitor | undefined;
	try {
		monitor =
			monitorConfig === false
				? undefined
				: await createMonitor({
						host,
						port: monitorConfig.port,
						...(monitorConfig.hostname === undefined ? {} : { hostname: monitorConfig.hostname }),
					});
	} catch (error) {
		await host.stop();
		store.close();
		throw error;
	}
	return {
		host,
		store,
		...(monitor === undefined ? {} : { monitor }),
		recovered,
		async stop() {
			await host.stop();
			await monitor?.close();
			store.close();
		},
	};
}
