import { Graph as Layout, layout } from "@dagrejs/dagre";
import {
	Background,
	BaseEdge,
	Controls,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	Handle,
	MarkerType,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Snapshot } from "@arbetslag/kernel";
import type { UnreadyEntry } from "../../src/protocol.ts";
import { cn } from "@/lib/utils";

type Shape = Snapshot["graph"]["shape"];

type GraphNodeData = {
	id: string;
	definition: string;
	mailbox: number;
	/** 以它为 origin 的在飞效果。 */
	inFlight: number;
	/** 其中正在执行的。 */
	executing: number;
	halted: boolean;
};

type TriggerNodeData = { id: string; kind: string; listener: string; unready?: string };

type FlowNode = Node<GraphNodeData, "node"> | Node<TriggerNodeData, "trigger">;

/** 边带端口名；`queued`：有沿它来的消息还排在目标的邮箱里。 */
type PortEdge = Edge<{ port: string; queued: boolean }, "port">;

const SIZE = { node: { width: 200, height: 68 }, trigger: { width: 180, height: 56 } } as const;

/** 只按形状排版：状态变了位置不动，形状变了才重排。 */
function place(shape: Shape): Map<string, { x: number; y: number }> {
	const g = new Layout({ multigraph: true });
	g.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 90 });
	g.setDefaultEdgeLabel(() => ({}));
	for (const id of Object.keys(shape.nodes)) g.setNode(id, { ...SIZE.node });
	for (const trigger of shape.triggers) g.setNode(trigger.id, { ...SIZE.trigger });
	for (const edge of shape.edges) g.setEdge(edge.from, edge.to, { label: edge.port, width: 60, height: 20 }, edge.port);
	layout(g);
	const positions = new Map<string, { x: number; y: number }>();
	for (const id of g.nodes()) {
		const { x, y, width, height } = g.node(id) as { x: number; y: number; width: number; height: number };
		positions.set(id, { x: x - width / 2, y: y - height / 2 });
	}
	return positions;
}

function GraphNode({ data, selected }: NodeProps<Node<GraphNodeData, "node">>) {
	return (
		<div
			className={cn(
				"bg-card text-card-foreground rounded-lg border-2 px-3 py-2 shadow-sm",
				data.halted
					? "border-destructive"
					: data.executing > 0
						? "border-amber-500"
						: data.mailbox > 0
							? "border-blue-600"
							: "border-border",
				selected && "ring-ring ring-2 ring-offset-2",
			)}
			style={SIZE.node}
		>
			<Handle type="target" position={Position.Left} />
			<div className="truncate font-mono text-sm font-semibold">{data.id}</div>
			<div className="text-muted-foreground truncate text-xs">{data.definition}</div>
			<div className="mt-1 flex gap-1 text-[10px]">
				{data.mailbox > 0 && <span className="rounded bg-blue-600 px-1 text-white">✉ {data.mailbox}</span>}
				{data.executing > 0 && <span className="rounded bg-amber-500 px-1 text-black">⚙ {data.executing}</span>}
				{data.inFlight > data.executing && (
					<span className="bg-muted rounded px-1">⏸ {data.inFlight - data.executing}</span>
				)}
				{data.halted && <span className="bg-destructive rounded px-1 text-white">halted</span>}
			</div>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

function TriggerNode({ data, selected }: NodeProps<Node<TriggerNodeData, "trigger">>) {
	return (
		<div
			className={cn(
				"bg-muted text-foreground rounded-full border-2 border-dashed px-4 py-2",
				data.unready === undefined ? "border-muted-foreground/50" : "border-destructive",
				selected && "ring-ring ring-2 ring-offset-2",
			)}
			style={SIZE.trigger}
			title={data.unready}
		>
			<div className="truncate font-mono text-sm font-semibold">⚡ {data.id}</div>
			<div className="text-muted-foreground truncate text-xs">
				{data.kind} · {data.listener}
				{data.unready !== undefined && <span className="text-destructive"> · unready</span>}
			</div>
			<Handle type="source" position={Position.Right} />
		</div>
	);
}

/** 标签用 HTML 画：xyflow 自带的 SVG 标签靠挂载时量尺寸，量到 0 就一直隐藏。 */
function PortEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<PortEdge>) {
	const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
	const queued = data?.queued === true;
	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				markerEnd={markerEnd}
				style={queued ? { stroke: "#2563eb", strokeWidth: 2, strokeDasharray: 5, animation: "dashdraw 0.5s linear infinite" } : undefined}
			/>
			<EdgeLabelRenderer>
				<div
					className={cn(
						"nodrag nopan absolute rounded border px-1 font-mono text-[11px]",
						queued ? "border-blue-600 bg-blue-600 text-white" : "bg-background text-muted-foreground",
					)}
					style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
				>
					{data?.port}
				</div>
			</EdgeLabelRenderer>
		</>
	);
}

const nodeTypes = { node: GraphNode, trigger: TriggerNode };
const edgeTypes = { port: PortEdgeView };

export function WorkflowGraph({
	snapshot,
	executing,
	unready,
	selected,
	onSelect,
}: {
	snapshot: Snapshot;
	executing: ReadonlySet<string>;
	unready: readonly UnreadyEntry[];
	selected: string | undefined;
	onSelect: (id: string | undefined) => void;
}) {
	const { shape, nodeStates } = snapshot.graph;
	/** 形状的指纹：只有它变了才重排、重新适配视口。 */
	const shapeKey = JSON.stringify([Object.keys(shape.nodes), shape.triggers.map((t) => t.id), shape.edges]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只随形状重排
	const positions = useMemo(() => place(shape), [shapeKey]);

	const nodes: FlowNode[] = [
		...Object.entries(shape.nodes).map(([id, record]): FlowNode => {
			const mine = snapshot.inFlight.filter((effect) => effect.origin === id);
			return {
				id,
				type: "node",
				position: positions.get(id) ?? { x: 0, y: 0 },
				selected: id === selected,
				data: {
					id,
					definition: record.definition,
					mailbox: nodeStates[id]?.mailbox.length ?? 0,
					inFlight: mine.length,
					executing: mine.filter((effect) => executing.has(effect.effectId)).length,
					halted: snapshot.halted?.node === id,
				},
			};
		}),
		...shape.triggers.map((trigger): FlowNode => {
			const reason = unready.find((u) => u.scope === "trigger" && u.trigger === trigger.id)?.reason;
			return {
				id: trigger.id,
				type: "trigger",
				position: positions.get(trigger.id) ?? { x: 0, y: 0 },
				selected: trigger.id === selected,
				data: {
					id: trigger.id,
					kind: trigger.kind,
					listener: trigger.listener,
					...(reason === undefined ? {} : { unready: reason }),
				},
			};
		}),
	];

	const triggerIds = new Set(shape.triggers.map((t) => t.id));
	const edges: PortEdge[] = shape.edges.map((edge) => {
		// 这条边上有消息排在目标的邮箱里：触发器投来的没有 `from`。
		const queued = (nodeStates[edge.to]?.mailbox ?? []).some(
			(entry) =>
				entry.message.type === edge.port &&
				(triggerIds.has(edge.from) ? entry.message.from === undefined : entry.message.from === edge.from),
		);
		return {
			id: `${edge.from}|${edge.port}|${edge.to}`,
			type: "port",
			source: edge.from,
			target: edge.to,
			markerEnd: { type: MarkerType.ArrowClosed },
			data: { port: edge.port, queued },
		};
	});

	return (
		<div className="bg-background h-[480px] w-full overflow-hidden rounded-xl border">
			<ReactFlow
				key={shapeKey}
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				colorMode="system"
				fitView
				fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
				nodesDraggable={false}
				nodesConnectable={false}
				edgesFocusable={false}
				onNodeClick={(_, node) => onSelect(node.id)}
				onPaneClick={() => onSelect(undefined)}
			>
				<Background />
				<Controls showInteractive={false} />
			</ReactFlow>
		</div>
	);
}
