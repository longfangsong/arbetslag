import { z } from "zod";

/** 有向的相邻关系；`port` 是发送侧出口的名字，也是沿它发出的消息的类别，必填（ADR-0002）。
 * 同一 `(from, port)` 可以有多条边——边是订阅，接了几个目标就是几条边（ADR-0011）。 */
export const edgeSchema = z.object({
	from: z.string().min(1),
	to: z.string().min(1),
	port: z.string().min(1),
});

export type Edge = z.infer<typeof edgeSchema>;
