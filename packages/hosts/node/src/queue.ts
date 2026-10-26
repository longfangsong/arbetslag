/**
 * 每条 key 一条等待线：同一个 key 的 work 按进入顺序逐个执行，不同 key 之间并行。
 *
 * 宿主用它实现 ADR-0003 的「串行入口」——对一份**工作流**，同一时刻只有一段代码在改它的快照。
 * 排队的单位是 `() => Promise<T>`，队列不关心它做什么，也没有给它起名词（`task` / `job` 是
 * **效果** 的 Avoid 词，见 `CONTEXT.md`）。
 */
export interface KeyedQueue<K = string> {
	/**
	 * 把 work 排到 `key` 那条队列上，按进入顺序逐个执行；不同 key 之间并行。
	 *
	 * - 保证同一个 key 内的代码不交错。
	 * - work 抛错时原样抛给调用方，队列继续：一次投递失败不卡死后面所有投递（ADR-0003）。
	 * - **不可嵌套**：work 内部不能再 `add` 同一个 key，那是在等自己。
	 */
	add<T>(key: K, work: () => Promise<T>): Promise<T>;
}

/**
 * 进程内的实现：每个 key 一条 promise 链。
 * 正确性不依赖它（CAS 加重试已经兜住，ADR-0003），它只决定「谁先谁后」；
 * 跨进程、跨机器的取舍是部署的事，这里不做。
 */
export function createKeyedQueue<K = string>(): KeyedQueue<K> {
	/** 队尾。链本身永不 reject，否则一条失败的 work 会毒死后面所有人的等待。 */
	const tails = new Map<K, Promise<void>>();

	return {
		async add(key, work) {
			const run = (tails.get(key) ?? Promise.resolve()).then(() => work());
			const tail = run.then(
				() => {},
				() => {},
			);
			tails.set(key, tail);
			try {
				return await run;
			} finally {
				// 后面还有人排着就把队尾让给它；队列空了就删掉这个 key，别攒 id。
				if (tails.get(key) === tail) tails.delete(key);
			}
		},
	};
}
