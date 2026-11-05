import { ArrowLeftIcon, OctagonXIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { UnreadyEntry, WorkflowDetail } from "../../src/protocol.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchDetail } from "./api.ts";
import { WorkflowGraph } from "./Graph.tsx";
import { Json } from "./Json.tsx";
import { StatusBadge } from "./status.tsx";

/** 一份工作流：形状画成图（点节点看它的细节），也按节点、边、触发器、在飞效果列成表。 */
export function Detail({
	id,
	touched,
	unready,
	onBack,
}: {
	id: string;
	touched: number | undefined;
	unready: readonly UnreadyEntry[];
	onBack: () => void;
}) {
	const [detail, setDetail] = useState<WorkflowDetail | null | undefined>();
	const [picked, setPicked] = useState<string | undefined>();

	// 每次这份工作流被推送就重新拉一次完整快照。
	useEffect(() => {
		let live = true;
		fetchDetail(id).then(
			(loaded) => live && setDetail(loaded ?? null),
			() => live && setDetail(null),
		);
		return () => {
			live = false;
		};
	}, [id, touched]);

	const back = (
		<Button variant="ghost" size="sm" onClick={onBack}>
			<ArrowLeftIcon /> All workflows
		</Button>
	);
	if (detail === undefined) return <div className="space-y-4">{back}</div>;
	if (detail === null) {
		return (
			<div className="space-y-4">
				{back}
				<Alert>
					<AlertTitle>No workflow "{id}"</AlertTitle>
				</Alert>
			</div>
		);
	}

	const { summary, snapshot, executing } = detail;
	const { shape, nodeStates } = snapshot.graph;
	const running = new Set(executing);
	const mine = unready.filter((u) => u.scope === "trigger" && u.workflowId === id);

	return (
		<div className="space-y-4">
			{back}
			<div className="flex flex-wrap items-center gap-3">
				<h2 className="font-mono text-xl font-semibold">{id}</h2>
				<StatusBadge status={summary.status} />
				<span className="text-muted-foreground text-sm">next seq {snapshot.nextSeq}</span>
			</div>

			{snapshot.halted !== undefined && (
				<Alert variant="destructive">
					<OctagonXIcon />
					<AlertTitle>
						Halted: {snapshot.halted.code}
						{snapshot.halted.node !== undefined && ` at ${snapshot.halted.node}`}
					</AlertTitle>
					<AlertDescription>
						<p>{snapshot.halted.detail}</p>
						<p className="text-xs">{snapshot.halted.at}</p>
					</AlertDescription>
				</Alert>
			)}

			<Tabs defaultValue="graph">
				<TabsList>
					<TabsTrigger value="graph">Graph</TabsTrigger>
					<TabsTrigger value="nodes">Nodes ({Object.keys(shape.nodes).length})</TabsTrigger>
					<TabsTrigger value="edges">Edges ({shape.edges.length})</TabsTrigger>
					<TabsTrigger value="triggers">Triggers ({shape.triggers.length})</TabsTrigger>
					<TabsTrigger value="effects">In-flight effects ({snapshot.inFlight.length})</TabsTrigger>
				</TabsList>

				<TabsContent value="graph" className="space-y-4">
					<WorkflowGraph
						snapshot={snapshot}
						executing={running}
						unready={mine}
						selected={picked}
						onSelect={setPicked}
					/>
					{picked === undefined ? (
						<p className="text-muted-foreground text-sm">
							Click a node or trigger to see its config, state and mailbox. Blue: messages waiting in the mailbox
							(the edge they came along is animated). Amber: effects executing. Red: halted here, or trigger
							unready.
						</p>
					) : (
						<Picked detail={detail} id={picked} running={running} unready={mine} />
					)}
				</TabsContent>

				<TabsContent value="nodes">
					<Card>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Node</TableHead>
										<TableHead>Definition</TableHead>
										<TableHead>Version</TableHead>
										<TableHead>Mailbox</TableHead>
										<TableHead>Config</TableHead>
										<TableHead>State</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{Object.entries(shape.nodes).map(([node, record]) => {
										const nodeState = nodeStates[node];
										const mailbox = nodeState?.mailbox ?? [];
										return (
											<TableRow key={node} className="align-top">
												<TableCell className="font-mono">{node}</TableCell>
												<TableCell>{record.definition}</TableCell>
												<TableCell>{nodeState?.version ?? "—"}</TableCell>
												<TableCell>
													{mailbox.length === 0 ? (
														<span className="text-muted-foreground">0</span>
													) : (
														<div className="space-y-1">
															<Badge className="bg-blue-600 text-white">{mailbox.length}</Badge>
															<Json value={mailbox} />
														</div>
													)}
												</TableCell>
												<TableCell>
													<Json value={record.config} />
												</TableCell>
												<TableCell className="whitespace-normal">
													<Json value={nodeState?.state} />
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="edges">
					<Card>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>From</TableHead>
										<TableHead>Port</TableHead>
										<TableHead>To</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{shape.edges.map((edge) => (
										<TableRow key={`${edge.from}|${edge.port}|${edge.to}`}>
											<TableCell className="font-mono">{edge.from}</TableCell>
											<TableCell className="font-mono">{edge.port}</TableCell>
											<TableCell className="font-mono">{edge.to}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="triggers">
					<Card>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Trigger</TableHead>
										<TableHead>Kind</TableHead>
										<TableHead>Listener</TableHead>
										<TableHead>Matcher</TableHead>
										<TableHead>Group / priority</TableHead>
										<TableHead>Config</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{shape.triggers.map((trigger) => (
										<TableRow key={trigger.id}>
											<TableCell className="font-mono">{trigger.id}</TableCell>
											<TableCell>{trigger.kind}</TableCell>
											<TableCell className="font-mono">{trigger.listener}</TableCell>
											<TableCell>{trigger.match === undefined ? "all" : <Json value={trigger.match} />}</TableCell>
											<TableCell>
												{JSON.stringify(trigger.group)} / {trigger.priority}
											</TableCell>
											<TableCell>
												<Json value={trigger.config} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="effects">
					<Card>
						<CardHeader>
							<CardTitle className="text-muted-foreground text-sm font-normal">
								"Executing" means a Performer in this activation has it right now; the rest are recorded in the
								snapshot and will be handed out again on recovery or resume.
							</CardTitle>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Effect id</TableHead>
										<TableHead>Kind</TableHead>
										<TableHead>Origin</TableHead>
										<TableHead>Correlation</TableHead>
										<TableHead>Executing</TableHead>
										<TableHead>Input</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{snapshot.inFlight.map((effect) => (
										<TableRow key={effect.effectId}>
											<TableCell className="font-mono">{effect.effectId}</TableCell>
											<TableCell>{effect.kind}</TableCell>
											<TableCell className="font-mono">{effect.origin}</TableCell>
											<TableCell className="font-mono">{effect.correlationId ?? "—"}</TableCell>
											<TableCell>
												{running.has(effect.effectId) ? (
													<Badge className="bg-amber-500 text-black">executing</Badge>
												) : (
													<span className="text-muted-foreground">no</span>
												)}
											</TableCell>
											<TableCell>
												<Json value={effect.input} />
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
		</div>
	);
}

/** 图上选中的那一个：节点给 config、state、邮箱、它发起的在飞效果；触发器给声明与未就绪原因。 */
function Picked({
	detail,
	id,
	running,
	unready,
}: {
	detail: WorkflowDetail;
	id: string;
	running: ReadonlySet<string>;
	unready: readonly UnreadyEntry[];
}) {
	const { shape, nodeStates } = detail.snapshot.graph;
	const record = shape.nodes[id];
	const trigger = shape.triggers.find((t) => t.id === id);

	if (record !== undefined) {
		const nodeState = nodeStates[id];
		const effects = detail.snapshot.inFlight.filter((effect) => effect.origin === id);
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<span className="font-mono">{id}</span>
						<Badge variant="secondary">
							{record.definition} v{nodeState?.version ?? "?"}
						</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<Field label="Config">
						<Json value={record.config} open />
					</Field>
					<Field label="State">
						<Json value={nodeState?.state} open />
					</Field>
					<Field label={`Mailbox (${nodeState?.mailbox.length ?? 0})`}>
						{(nodeState?.mailbox.length ?? 0) === 0 ? (
							<span className="text-muted-foreground text-sm">empty</span>
						) : (
							<Json value={nodeState?.mailbox} open />
						)}
					</Field>
					<Field label={`In-flight effects (${effects.length})`}>
						{effects.length === 0 ? (
							<span className="text-muted-foreground text-sm">none</span>
						) : (
							<ul className="space-y-1 text-sm">
								{effects.map((effect) => (
									<li key={effect.effectId} className="flex items-center gap-2">
										<span className="font-mono">{effect.effectId}</span>
										<span>{effect.kind}</span>
										{running.has(effect.effectId) && <Badge className="bg-amber-500 text-black">executing</Badge>}
									</li>
								))}
							</ul>
						)}
					</Field>
				</CardContent>
			</Card>
		);
	}

	if (trigger !== undefined) {
		const reason = unready.find((u) => u.scope === "trigger" && u.trigger === id)?.reason;
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<span className="font-mono">{id}</span>
						<Badge variant="secondary">trigger · {trigger.kind}</Badge>
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<Field label="Listener">
						<span className="font-mono text-sm">{trigger.listener}</span>
						{reason !== undefined && <p className="text-destructive text-sm">unready: {reason}</p>}
					</Field>
					<Field label="Group / priority">
						<span className="text-sm">
							{JSON.stringify(trigger.group)} / {trigger.priority}
						</span>
					</Field>
					<Field label="Matcher">
						{trigger.match === undefined ? <span className="text-sm">all</span> : <Json value={trigger.match} open />}
					</Field>
					<Field label="Config">
						<Json value={trigger.config} open />
					</Field>
				</CardContent>
			</Card>
		);
	}

	// 刚被回收：形状里已经没有它了。
	return <p className="text-muted-foreground text-sm">"{id}" is no longer in the graph.</p>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0 space-y-1">
			<div className="text-muted-foreground text-xs font-medium uppercase">{label}</div>
			{children}
		</div>
	);
}
