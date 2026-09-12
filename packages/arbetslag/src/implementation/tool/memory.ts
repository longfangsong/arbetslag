import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import { Tool, ToolExecutingContext } from "@/application/tool/model";
import { Agent } from "@/application/agent/model";

export const MEMORY_FILE = "MEMORY.md";

const SimpleMemoryReadInputSchema = z.object({}).strict();
const SimpleMemoryUpdateInputSchema = z
	.object({
		content: z
			.string()
			.describe("The durable fact to record in MEMORY.md."),
	})
	.strict();

/**
 * Long-term memory tools backed by a MEMORY.md file at the root of the
 * agent's file system.
 *
 * ponytail: MEMORY.md grows unbounded on `update_memory`, and `read_memory`
 * returns the whole file into the context window. Summarise / prune MEMORY.md
 * (e.g. on the daily context reset) before this becomes a context-length problem.
 */
export class SimpleMemoryRead implements Tool<
	z.infer<typeof SimpleMemoryReadInputSchema>,
	string,
	string
> {
	name = "read_memory";
	description = `Load long-term memory (MEMORY.md). ALWAYS call this at the start of a new context/session to recover who is who, ongoing topics & debates, group jokes/jargon, and member/user preferences.`;
	inputSchema = SimpleMemoryReadInputSchema;

	call(
		context: ToolExecutingContext,
		_caller: Agent,
		_input: z.infer<typeof SimpleMemoryReadInputSchema>,
	): Promise<Result<string, string>> {
		return readMemory(context.fileSystem);
	}
}

export class SimpleMemoryUpdate implements Tool<
	z.infer<typeof SimpleMemoryUpdateInputSchema>,
	string,
	string
> {
	name = "update_memory";
	description = `Append one durable fact to long-term memory (MEMORY.md). Only record stable, useful-over-time facts (member identities & relationships, ongoing topics & debates, group jargon, member & user preferences). Do NOT record one-off chit-chat, throwaway memes, sensitive privacy, or emotional outbursts.`;
	inputSchema = SimpleMemoryUpdateInputSchema;

	call(
		context: ToolExecutingContext,
		_caller: Agent,
		input: z.infer<typeof SimpleMemoryUpdateInputSchema>,
	): Promise<Result<string, string>> {
		const fact = input.content?.trim();
		if (!fact) {
			return Promise.resolve(
				err("update_memory requires a non-empty 'content' fact."),
			);
		}
		return writeMemory(context.fileSystem, fact);
	}
}

async function readMemory(
	fileSystem: ToolExecutingContext["fileSystem"],
): Promise<Result<string, string>> {
	try {
		const content = await fileSystem.readFile(MEMORY_FILE);
		return ok(
			content.trim()
				? content
				: "(MEMORY.md is empty — no long-term memory yet.)",
		);
	} catch {
		return ok("(MEMORY.md does not exist yet — no long-term memory.)");
	}
}

async function writeMemory(
	fileSystem: ToolExecutingContext["fileSystem"],
	fact: string,
): Promise<Result<string, string>> {
	const timestamp = new Date().toISOString();
	const entry = `- [${timestamp}] ${fact}`;
	try {
		let existing = "";
		try {
			existing = await fileSystem.readFile(MEMORY_FILE);
		} catch {
			existing = "";
		}
		const next = existing.trim()
			? `${existing.trim()}\n${entry}\n`
			: `${entry}\n`;
		await fileSystem.writeFile(MEMORY_FILE, next);
		return ok("Saved to MEMORY.md.");
	} catch (error) {
		return err(
			`Failed to write MEMORY.md: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
