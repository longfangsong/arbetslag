import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Result } from "neverthrow";
import { Orchestrator, type OrchestratorDeps } from "@/application/orchestrator";
import type { Event, MessageEvent } from "@/application/event/event";
import type { Template } from "@/application/agent/template/model";
import type { Repository as AgentRepository } from "@/application/agent/repository";
import type { Tool } from "@/application/tool/model";
import { NodeFileSystem } from "@/implementation/tool/file/filesystem/nodeFs";
import { FileSystemAgentRepository } from "@/implementation/agent/repository";
import { FileSystemTemplateRepository } from "@/implementation/agent/template/repository";
import { FileSystemToolStateRepository } from "@/implementation/tool/state";
import { InMemoryToolRepository } from "@/implementation/tool/repository";
import { InMemoryAIProviderRepository } from "@/implementation/aiProvider/inMemory";
import { Telegram } from "@/implementation/outputRouter/telegram";
import { text } from "@/application/agent/history";
import { FakeLLM, type Behavior } from "./fake-llm";
import { FakeApi, MOCK_TELEGRAM_BASE } from "./fake-api";

export interface HarnessOptions {
	rules: Map<RegExp, Behavior | Array<Behavior>>;
	templates: Array<Template>;
	tools: Array<Tool<unknown, unknown, unknown>>;
}

export interface Harness {
	dir: string;
	fileSystem: NodeFileSystem;
	agentRepository: AgentRepository;
	llm: FakeLLM;
	api: FakeApi;
	orchestrator: Orchestrator;
	/** Push one event and run the loop until idle; returns the orchestrator result. */
	run(event: Event): Promise<Result<void, string>>;
	close(): Promise<void>;
}

/** Everything below this point is real production code: only LLM + fetch are mocked. */
export async function createHarness(o: HarnessOptions): Promise<Harness> {
	const dir = await mkdtemp(join(tmpdir(), "arbetslag-e2e-"));
	const fileSystem = new NodeFileSystem(dir);
	const llm = new FakeLLM(o.rules);
	const api = new FakeApi();
	api.install();

	const agentRepository = await FileSystemAgentRepository.create(fileSystem, "agents/");
	const templateRepository = await FileSystemTemplateRepository.create(fileSystem, "config/templates/");
	for (const template of o.templates) await templateRepository.add(template);

	const orchestrator = new Orchestrator({
		fileSystem,
		agentRepository,
		templateRepository,
		toolRepository: new InMemoryToolRepository(o.tools),
		toolState: new FileSystemToolStateRepository(fileSystem, "tool_state/"),
		aiProviderRepository: new InMemoryAIProviderRepository([llm]),
		outputRouter: new Telegram("test-token", "chat-1", MOCK_TELEGRAM_BASE),
	} satisfies OrchestratorDeps);

	return {
		dir,
		fileSystem,
		agentRepository,
		llm,
		api,
		orchestrator,
		run: async (event: Event) => {
			orchestrator.push(event);
			return orchestrator.stepUntilIdle(100);
		},
		close: async () => {
			api.uninstall();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

/** A fixed event (literal ids, no nanoid) so assertions stay stable. */
export function messageEvent(content: string, sender = "alice"): MessageEvent {
	return {
		id: "evt-1",
		event_type: "message",
		chat_id: "chat-1",
		adapter: "telegram",
		content: text(content),
		send_time: 1735689600000, // 2025-01-01T00:00:00Z
		sender,
	};
}
