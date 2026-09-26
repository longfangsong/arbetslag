/**
 * Persisted tool-owned state: one JSON file per key, where the key is a
 * tool namespace in snake_case (`subagent`, `cron`) — same convention as tool
 * names.
 *
 * Values must be JSON-safe (plain object/array/primitive — no Map, Set, Date
 * or class instances), because the framework checkpoints state after each step
 * and can only persist what serializes. The repository does not validate: it
 * stores what it is given and reads back whatever JSON produced.
 */
export interface ToolStateRepository {
	/** Null when the key has no state yet, or when the stored file is not JSON. */
	get<T>(key: string): Promise<T | null>;
	/** Write-through: committed here, not at the end of the tool call. */
	set<T>(key: string, value: T): Promise<void>;
}
