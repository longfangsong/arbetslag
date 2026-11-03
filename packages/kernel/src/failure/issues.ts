import type { z } from "zod";

/** 把 zod 的错误压成一行给人看的文本（停住原因与违规里的 `detail`）。 */
export function formatIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
		.join("; ");
}
