/** `sqliteStore.test.ts` 的另一个进程：试着打开同一个存储文件，把结果报回去。 */
import { createSqliteStore } from "../../src/sqliteStore.ts";

try {
	const store = createSqliteStore({ file: process.argv[2] ?? "" });
	store.close();
	process.send?.({ ok: true });
} catch (error) {
	const { name, message } = error as Error;
	process.send?.({ ok: false, name, message });
}
