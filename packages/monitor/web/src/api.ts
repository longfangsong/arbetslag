import type { CreateRefusal, TemplateEntry, WorkflowDetail } from "../../src/protocol.ts";

export async function fetchDetail(id: string): Promise<WorkflowDetail | undefined> {
	const response = await fetch(`api/workflows/${encodeURIComponent(id)}`);
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`GET workflow ${id}: ${response.status}`);
	return (await response.json()) as WorkflowDetail;
}

export type CreateOutcome = { ok: true; id: string } | { ok: false; refusal: CreateRefusal | { code: "unexpected"; detail: string } };

export async function fetchTemplates(): Promise<TemplateEntry[]> {
	const response = await fetch("api/templates");
	if (!response.ok) throw new Error(`GET templates: ${response.status}`);
	return (await response.json()) as TemplateEntry[];
}

/** `template`：模板目录里的名字，或上传的整份模板。 */
export async function createWorkflow(
	template: unknown,
	id: string | undefined,
	params: Record<string, unknown> | undefined,
): Promise<CreateOutcome> {
	const response = await fetch("api/workflows", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			template,
			...(id === undefined ? {} : { id }),
			...(params === undefined ? {} : { params }),
		}),
	});
	const body = (await response.json().catch(() => undefined)) as unknown;
	if (response.status === 201) return { ok: true, id: (body as { id: string }).id };
	if (response.status === 400 || response.status === 409) return { ok: false, refusal: body as CreateRefusal };
	return { ok: false, refusal: { code: "unexpected", detail: `HTTP ${response.status}` } };
}
