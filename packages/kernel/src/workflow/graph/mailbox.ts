import { z } from "zod";
import { messageSchema } from "../../message.ts";

/**
 * 邮箱里的一条消息，连同它的入队序号（ADR-0007）。
 * 序号是内核对邮箱的簿记：全局单调递增，只用来定跨邮箱的处理顺序；
 * 它不在信封上，节点读不到也伪造不了。
 */
export const mailboxEntrySchema = z.object({
	seq: z.number().int().nonnegative(),
	message: messageSchema,
});

export type MailboxEntry = z.infer<typeof mailboxEntrySchema>;
