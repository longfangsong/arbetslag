import type { CreateRefusal, WorkflowDetail } from "../../src/protocol.ts";

export async function fetchDetail(id: string): Promise<WorkflowDetail | undefined> {
	const response = await fetch(`api/workflows/${encodeURIComponent(id)}`);
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`GET workflow ${id}: ${response.status}`);
	return (await response.json()) as WorkflowDetail;
}

export type CreateOutcome = { ok: true; id: string } | { ok: false; refusal: CreateRefusal | { code: "unexpected"; detail: string } };

export async function createWorkflow(template: unknown, id: string | undefined): Promise<CreateOutcome> {
	const response = await fetch("api/workflows", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(id === undefined ? { template } : { template, id }),
	});
	const body = (await response.json().catch(() => undefined)) as unknown;
	if (response.status === 201) return { ok: true, id: (body as { id: string }).id };
	if (response.status === 400 || response.status === 409) return { ok: false, refusal: body as CreateRefusal };
	return { ok: false, refusal: { code: "unexpected", detail: `HTTP ${response.status}` } };
}
