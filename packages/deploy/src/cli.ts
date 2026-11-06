#!/usr/bin/env node
/**
 * `arbetslag run <config.yaml>`：按部署配置起一个激活（ADR-0018）。
 * 配置有错就把问题全列出来、退出码 1，不启动。
 */
import { DeploymentError } from "./config.ts";
import { prepareDeployment, startDeployment } from "./deployment.ts";

const USAGE = "usage: arbetslag run <config.yaml>";

async function main(argv: readonly string[]): Promise<number> {
	const [command, file] = argv;
	if (command !== "run" || file === undefined) {
		console.error(USAGE);
		return 2;
	}

	let deployment: Awaited<ReturnType<typeof prepareDeployment>>;
	try {
		deployment = await prepareDeployment(file);
	} catch (error) {
		if (error instanceof DeploymentError) {
			console.error(error.message);
			return 1;
		}
		throw error;
	}

	const running = await startDeployment(deployment);
	const { config, templates } = deployment;
	console.log(`store      ${config.store}`);
	console.log(`templates  ${Object.keys(templates).join(", ") || "(none)"}`);
	console.log(`listeners  ${config.listeners.map((l) => `${l.id} (${l.kind})`).join(", ") || "(none)"}`);
	console.log(`providers  ${Object.keys(config.providers).join(", ") || "(none)"}`);
	console.log(
		`recovered  ${running.recovered.scanned} workflows, ${running.recovered.redispatched} effects handed out again`,
	);
	console.log(`monitor    ${running.monitor?.url ?? "(off)"}`);

	await new Promise<void>((resolve) => {
		for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
	});
	await running.stop();
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
