import { z } from "zod";
import { Result, ok, err } from "neverthrow";
import type { FileSystem, Tool } from "arbetslag";

type MemoryInput = z.infer<typeof MemoryInputSchema>;
type ToolExecutingContext = { fileSystem: FileSystem };

/**
 * Long-term memory tool for the virtual group-member bot.
 *
 * MEMORY.md lives at the root of the bot's file system and is surfaced to the
 * LLM via the `read` action (see arbetslag.yaml prompt).
 *
 * ponytail: MEMORY.md grows unbounded on `update`, and `read` returns the whole
 * file into the context window. Summarise / prune MEMORY.md (e.g. on the daily
 * context reset) before this becomes a context-length problem.
 */
export const MEMORY_FILE = "MEMORY.md";

const MemoryInputSchema = z
	.object({
		action: z
			.enum(["read", "update"])
			.describe(
				"read: load long-term memory — call at the start of every new context/session. update: append one durable fact.",
			),
		content: z
			.string()
			.optional()
			.describe("For update: the durable fact to record in MEMORY.md."),
	})
	.strict();

export class MemoryTool implements Tool<MemoryInput, string, string> {
	name = "memory";
	description = `Long-term memory, persisted in MEMORY.md.
read: restore your long-term memory. ALWAYS call this at the start of a new context/session to recover who is who, ongoing topics & debates, group jokes/jargon, and member/user preferences.
update: append one durable fact to MEMORY.md. Only record stable, useful-over-time facts (member identities & relationships, ongoing topics & debates, group jargon, member & user preferences). Do NOT record one-off chit-chat, throwaway memes, sensitive privacy, or emotional outbursts.`;
	inputSchema = MemoryInputSchema;

	call(
		context: ToolExecutingContext,
		_caller: unknown,
		input: MemoryInput,
	): Promise<Result<string, string>> {
		if (input.action === "read") {
			return readMemory(context.fileSystem);
		}

		const fact = input.content?.trim();
		if (!fact) {
			return Promise.resolve(err("memory.update requires a non-empty 'content' fact."));
		}
		return writeMemory(context.fileSystem, fact);
	}
}

async function readMemory(fileSystem: ToolExecutingContext["fileSystem"]): Promise<Result<string, string>> {
	try {
		const content = await fileSystem.readFile(MEMORY_FILE);
		return ok(content.trim() ? content : "(MEMORY.md is empty — no long-term memory yet.)");
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
		const next = existing.trim() ? `${existing.trim()}\n${entry}\n` : `${entry}\n`;
		await fileSystem.writeFile(MEMORY_FILE, next);
		return ok("Saved to MEMORY.md.");
	} catch (error) {
		return err(
			`Failed to write MEMORY.md: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

