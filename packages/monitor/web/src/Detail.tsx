import { ArrowLeftIcon, OctagonXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkflowDetail } from "../../src/protocol.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchDetail } from "./api.ts";
import { Json } from "./Json.tsx";
import { StatusBadge } from "./status.tsx";

/** 一份工作流：形状用表格列出（v1 不画图），外加邮箱、节点 state 与在飞效果。 */
export function Detail({ id, touched, onBack }: { id: string; touched: number | undefined; onBack: () => void }) {
	const [detail, setDetail] = useState<WorkflowDetail | null | undefined>();

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

			<Tabs defaultValue="nodes">
				<TabsList>
					<TabsTrigger value="nodes">Nodes ({Object.keys(shape.nodes).length})</TabsTrigger>
					<TabsTrigger value="edges">Edges ({shape.edges.length})</TabsTrigger>
					<TabsTrigger value="triggers">Triggers ({shape.triggers.length})</TabsTrigger>
					<TabsTrigger value="effects">In-flight effects ({snapshot.inFlight.length})</TabsTrigger>
				</TabsList>

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
