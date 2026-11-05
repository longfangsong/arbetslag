import { PlusIcon } from "lucide-react";
import { useState } from "react";
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
import { type CreateOutcome, createWorkflow } from "./api.ts";

type Refusal = Extract<CreateOutcome, { ok: false }>["refusal"];

function describe(refusal: Refusal): string[] {
	switch (refusal.code) {
		case "template_invalid":
			return refusal.violations.map((v) => JSON.stringify(v));
		case "workflow_exists":
			return [`A workflow with id "${refusal.id}" already exists.`];
		default:
			return [refusal.detail];
	}
}

/** 唯一的写操作：上传一份模板（JSON），实例化成一份新工作流。 */
export function CreateDialog({ onCreated }: { onCreated: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | undefined>();
	const [id, setId] = useState("");
	const [problems, setProblems] = useState<{ title: string; lines: string[] } | undefined>();
	const [busy, setBusy] = useState(false);

	const reset = () => {
		setFile(undefined);
		setId("");
		setProblems(undefined);
	};

	async function submit() {
		if (file === undefined) return;
		setBusy(true);
		setProblems(undefined);
		try {
			let template: unknown;
			try {
				template = JSON.parse(await file.text());
			} catch {
				setProblems({ title: "Not JSON", lines: [`${file.name} could not be parsed as JSON.`] });
				return;
			}
			const outcome = await createWorkflow(template, id.trim() === "" ? undefined : id.trim());
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
						Upload a template as JSON: <code>{"{ nodes, edges?, triggers? }"}</code>. It is checked against this
						deployment's registry before anything is written.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="template">Template</Label>
						<Input
							id="template"
							type="file"
							accept="application/json,.json"
							onChange={(e) => setFile(e.target.files?.[0])}
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
					<Button onClick={() => void submit()} disabled={file === undefined || busy}>
						{busy ? "Creating…" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
