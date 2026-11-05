import { CircleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CreateDialog } from "./CreateDialog.tsx";
import { Detail } from "./Detail.tsx";
import { StatusBadge } from "./status.tsx";
import { useMonitor } from "./useMonitor.ts";

/** `#/workflows/<id>`：链接得到、刷新不丢。 */
function useSelected(): [string | undefined, (id: string | undefined) => void] {
	const read = () => {
		const match = /^#\/workflows\/(.+)$/.exec(window.location.hash);
		return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
	};
	const [selected, setSelected] = useState(read);
	useEffect(() => {
		const onHash = () => setSelected(read());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	const select = (id: string | undefined) => {
		window.location.hash = id === undefined ? "" : `#/workflows/${encodeURIComponent(id)}`;
	};
	return [selected, select];
}

export function App() {
	const { connected, workflows, unready, touched } = useMonitor();
	const [selected, select] = useSelected();
	const list = [...(workflows?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id));

	return (
		<div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
			<header className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-semibold">arbetslag</h1>
					<span className="text-muted-foreground flex items-center gap-1.5 text-sm">
						<span className={cn("size-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground")} />
						{connected ? "live" : "disconnected"}
					</span>
				</div>
				<CreateDialog onCreated={(id) => select(id)} />
			</header>

			{unready.length > 0 && (
				<Alert>
					<CircleAlertIcon />
					<AlertTitle>Unready ({unready.length})</AlertTitle>
					<AlertDescription>
						<ul className="list-disc pl-4">
							{unready.map((entry) =>
								entry.scope === "listener" ? (
									<li key={`l:${entry.listener}`}>
										listener <code>{entry.listener}</code>: {entry.reason}
									</li>
								) : (
									<li key={`t:${entry.workflowId}:${entry.trigger}`}>
										trigger <code>{entry.trigger}</code> of <code>{entry.workflowId}</code>: {entry.reason}
									</li>
								),
							)}
						</ul>
					</AlertDescription>
				</Alert>
			)}

			{selected !== undefined ? (
				<Detail id={selected} touched={touched.get(selected)} onBack={() => select(undefined)} />
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Workflows</CardTitle>
						<CardDescription>
							{workflows === undefined ? "Connecting…" : `${list.length} in this activation's store`}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Id</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">Nodes</TableHead>
									<TableHead className="text-right">Triggers</TableHead>
									<TableHead className="text-right">Mailbox</TableHead>
									<TableHead className="text-right">In flight</TableHead>
									<TableHead className="text-right">Executing</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{list.map((w) => (
									<TableRow key={w.id} className="cursor-pointer" onClick={() => select(w.id)}>
										<TableCell className="font-mono">{w.id}</TableCell>
										<TableCell>
											<StatusBadge status={w.status} />
											{w.halted !== undefined && (
												<span className="text-muted-foreground ml-2 text-xs">{w.halted.code}</span>
											)}
										</TableCell>
										<TableCell className="text-right">{w.nodes}</TableCell>
										<TableCell className="text-right">{w.triggers}</TableCell>
										<TableCell className="text-right">{w.mailbox}</TableCell>
										<TableCell className="text-right">{w.inFlight}</TableCell>
										<TableCell className="text-right">{w.executing}</TableCell>
									</TableRow>
								))}
								{workflows !== undefined && list.length === 0 && (
									<TableRow>
										<TableCell colSpan={7} className="text-muted-foreground text-center">
											No workflows yet.
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
