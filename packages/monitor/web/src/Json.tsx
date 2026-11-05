import { useState } from "react";

/** 折叠的 JSON：节点 state、config、邮箱条目、效果 input 都可能很大。 */
export function Json({ value, open = false }: { value: unknown; open?: boolean }) {
	const [expanded, setExpanded] = useState(open);
	const text = JSON.stringify(value, null, 2) ?? "undefined";
	const preview = JSON.stringify(value) ?? "undefined";
	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => setExpanded(true)}
				className="text-muted-foreground hover:text-foreground block max-w-xs truncate text-left font-mono text-xs"
				title="Expand"
			>
				{preview}
			</button>
		);
	}
	return (
		<div>
			<button
				type="button"
				onClick={() => setExpanded(false)}
				className="text-muted-foreground hover:text-foreground mb-1 text-xs underline"
			>
				collapse
			</button>
			<pre className="bg-muted max-h-96 overflow-auto rounded-md p-2 font-mono text-xs">{text}</pre>
		</div>
	);
}
