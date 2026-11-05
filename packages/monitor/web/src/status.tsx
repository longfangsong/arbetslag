import type { WorkflowStatus } from "../../src/protocol.ts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 名字与 `CONTEXT.md` 一致：停住、可推进、等回执、静止。 */
const LOOK: Record<WorkflowStatus, { label: string; className: string }> = {
	halted: { label: "Halted", className: "bg-destructive text-white border-transparent" },
	runnable: { label: "Runnable", className: "bg-blue-600 text-white border-transparent" },
	in_flight: { label: "In flight", className: "bg-amber-500 text-black border-transparent" },
	quiescent: { label: "Quiescent", className: "" },
};

export function StatusBadge({ status }: { status: WorkflowStatus }) {
	const look = LOOK[status];
	return (
		<Badge variant={status === "quiescent" ? "secondary" : "default"} className={cn(look.className)}>
			{look.label}
		</Badge>
	);
}
