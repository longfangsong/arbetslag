import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { parse as parseYaml } from "yaml";
import type { TemplateEntry } from "../../src/protocol.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CreateOutcome, createWorkflow, fetchTemplates } from "./api.ts";

type Refusal = Extract<CreateOutcome, { ok: false }>["refusal"];
type Source = "directory" | "upload";

function describe(refusal: Refusal): string[] {
	switch (refusal.code) {
		case "template_invalid":
			return refusal.violations.map((v) => JSON.stringify(v));
		case "template_unknown":
			return [`The deployment has no template named "${refusal.name}".`];
		case "workflow_exists":
			return [`A workflow with id "${refusal.id}" already exists.`];
		default:
			return [refusal.detail];
	}
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/** 上传的模板：`.json` 按 JSON 读，其余按 YAML 读（JSON 也是合法的 YAML）。 */
async function readTemplate(file: File): Promise<unknown> {
	const text = await file.text();
	return file.name.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
}

/**
 * 唯一的写操作：创建一份新工作流。模板从部署的模板目录里选（ADR-0018），或者上传一份 JSON / YAML；
 * 两种都能填参数，表单预先填好模板声明的默认值。
 */
export function CreateDialog({ onCreated }: { onCreated: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState<Source>("directory");
	const [entries, setEntries] = useState<TemplateEntry[] | undefined>();
	const [name, setName] = useState("");
	const [uploaded, setUploaded] = useState<{ file: string; template: unknown } | undefined>();
	const [params, setParams] = useState("{}");
	const [id, setId] = useState("");
	const [problems, setProblems] = useState<{ title: string; lines: string[] } | undefined>();
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		fetchTemplates().then(
			(loaded) => {
				setEntries(loaded);
				const first = loaded[0];
				if (first !== undefined) {
					setName(first.name);
					setParams(pretty(first.params));
				} else {
					setSource("upload");
				}
			},
			() => setEntries([]),
		);
	}, [open]);

	const reset = () => {
		setSource("directory");
		setName("");
		setUploaded(undefined);
		setParams("{}");
		setId("");
		setProblems(undefined);
	};

	const pick = (next: string) => {
		setName(next);
		setParams(pretty(entries?.find((entry) => entry.name === next)?.params ?? {}));
	};

	async function upload(file: File | undefined) {
		setProblems(undefined);
		if (file === undefined) {
			setUploaded(undefined);
			return;
		}
		try {
			const template = await readTemplate(file);
			setUploaded({ file: file.name, template });
			const declared = (template as { params?: unknown } | null)?.params;
			setParams(pretty(declared ?? {}));
		} catch (error) {
			setUploaded(undefined);
			setProblems({ title: "Cannot read file", lines: [error instanceof Error ? error.message : String(error)] });
		}
	}

	async function submit() {
		const template = source === "directory" ? name : uploaded?.template;
		if (template === undefined || template === "") return;
		let given: Record<string, unknown>;
		try {
			given = params.trim() === "" ? {} : (JSON.parse(params) as Record<string, unknown>);
			if (typeof given !== "object" || given === null || Array.isArray(given)) throw new Error("not an object");
		} catch {
			setProblems({ title: "Params are not a JSON object", lines: [params] });
			return;
		}
		setBusy(true);
		setProblems(undefined);
		try {
			const outcome = await createWorkflow(template, id.trim() === "" ? undefined : id.trim(), given);
			if (outcome.ok) {
				setOpen(false);
				reset();
				onCreated(outcome.id);
			} else {
				setProblems({ title: outcome.refusal.code, lines: describe(outcome.refusal) });
			}
		} finally {
			setBusy(false);
		}
	}

	const ready = source === "directory" ? name !== "" : uploaded !== undefined;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button>
					<PlusIcon /> New workflow
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>New workflow</DialogTitle>
					<DialogDescription>
						Pick a template from this deployment's template directory, or upload one (JSON or YAML). It is checked
						against the registry before anything is written.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<Tabs value={source} onValueChange={(value) => setSource(value as Source)}>
						<TabsList>
							<TabsTrigger value="directory" disabled={entries?.length === 0}>
								From directory
							</TabsTrigger>
							<TabsTrigger value="upload">Upload</TabsTrigger>
						</TabsList>
						<TabsContent value="directory" className="grid gap-2 pt-2">
							<Label htmlFor="template-name">Template</Label>
							<select
								id="template-name"
								value={name}
								onChange={(e) => pick(e.target.value)}
								className="border-input dark:bg-input/30 h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs"
							>
								{(entries ?? []).map((entry) => (
									<option key={entry.name} value={entry.name}>
										{entry.name}
									</option>
								))}
							</select>
						</TabsContent>
						<TabsContent value="upload" className="grid gap-2 pt-2">
							<Label htmlFor="template-file">Template file</Label>
							<Input
								id="template-file"
								type="file"
								accept=".json,.yaml,.yml,application/json,application/yaml"
								onChange={(e) => void upload(e.target.files?.[0])}
							/>
						</TabsContent>
					</Tabs>
					<div className="grid gap-2">
						<Label htmlFor="template-params">Params (JSON)</Label>
						<textarea
							id="template-params"
							value={params}
							onChange={(e) => setParams(e.target.value)}
							rows={4}
							spellCheck={false}
							className="border-input dark:bg-input/30 rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs"
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="workflow-id">Id (optional)</Label>
						<Input
							id="workflow-id"
							placeholder="random if left empty"
							value={id}
							onChange={(e) => setId(e.target.value)}
						/>
					</div>
					{problems !== undefined && (
						<Alert variant="destructive">
							<AlertTitle>{problems.title}</AlertTitle>
							<AlertDescription>
								<ul className="max-h-48 list-disc overflow-auto pl-4 font-mono text-xs">
									{problems.lines.map((line) => (
										<li key={line}>{line}</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					)}
				</div>
				<DialogFooter>
					<Button onClick={() => void submit()} disabled={!ready || busy}>
						{busy ? "Creating…" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
