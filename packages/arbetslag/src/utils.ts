import { customAlphabet } from "nanoid/non-secure";
const ALPHABET = "346789ABCDEFGHJKLMNPQRTUWXY";

/**
 * For content keys — a session id in a `Store` — never for node identity.
 *
 * Nodes are identified by their position in a project's node list, so nothing in
 * the graph needs a minted string. This stays here because a random key is the
 * right thing for a new conversation, and the wrong thing for anything the graph
 * has to find again after a restart.
 */
// biome-ignore lint/style/useNamingConvention: exported as a function
export const nanoid: () => string = customAlphabet(ALPHABET, 12);

/**
 * The class name a project file uses to refer to a node, and the key a `Runtime`
 * factory is registered under.
 *
 * Derived, never written down: there is exactly one spelling of a class's name,
 * so a factory cannot drift from the class it builds. (This does mean renaming a
 * node class invalidates existing project files, and that minifying user code
 * would break the match — loudly, see `Runtime.build`.)
 */
export function classNameOf(instance: object): string {
	return instance.constructor.name;
}

/**
 * The name a tool or provider is known by *outside* the process: what the model
 * sees as a function name, and what a serialized agent stores in `allowedTools`
 * or `api`.
 *
 * Derived from the class for the same reason: `EchoTool` → `echo`,
 * `OpenAIProvider` → `openAI`. Nobody invents it, so it can't drift from the
 * implementation — and a random string could never be a function name.
 */
export function nodeName(instance: object): string {
	return classNameOf(instance)
		.replace(/(Tool|Provider|API)$/, "")
		.replace(/^./, (first: string): string => first.toLowerCase());
}
