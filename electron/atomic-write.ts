import fs from "node:fs/promises";
import { renameWithRetry } from "./atomic-rename";

/**
 * Temp file, flush, then rename over the target: a crash or a full disk leaves the old file
 * intact instead of a truncated one. The suffix follows the extension so nothing lists the
 * leftover as a project.
 */
export async function writeFileAtomic(filePath: string, data: string): Promise<void> {
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	const handle = await fs.open(tempPath, "w");
	try {
		await handle.writeFile(data, "utf-8");
		await handle.sync();
	} catch (error) {
		await handle.close().catch(() => undefined);
		await fs.unlink(tempPath).catch(() => undefined);
		throw error;
	}
	await handle.close();
	try {
		await renameWithRetry(tempPath, filePath);
	} catch (error) {
		await fs.unlink(tempPath).catch(() => undefined);
		throw error;
	}
}
