import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic } from "./atomic-write";

describe("writeFileAtomic", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-write-"));
	});
	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true });
	});

	it("creates the file and leaves no temp file behind", async () => {
		const target = path.join(dir, "a.openscreen");
		await writeFileAtomic(target, '{"v":1}');
		expect(await fs.readFile(target, "utf-8")).toBe('{"v":1}');
		expect(await fs.readdir(dir)).toEqual(["a.openscreen"]);
	});

	it("replaces an existing file whole", async () => {
		const target = path.join(dir, "a.openscreen");
		await fs.writeFile(target, "x".repeat(1000));
		await writeFileAtomic(target, "short");
		expect(await fs.readFile(target, "utf-8")).toBe("short");
	});

	it("keeps the old file and cleans up when the target cannot be replaced", async () => {
		const target = path.join(dir, "a.openscreen");
		await fs.mkdir(target); // a directory in the way makes the rename fail
		await expect(writeFileAtomic(target, "data")).rejects.toThrow();
		expect((await fs.readdir(dir)).filter((f) => f.includes(".tmp-"))).toEqual([]);
	});
});
