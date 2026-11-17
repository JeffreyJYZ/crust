/**
 * Plain-HTML dev reload, driver side: the public/ watch, its dev.url opt-out, and
 * the "failed rebuild must not reload" gate. Watches are real and bounded.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEV_RELOAD_EVENT,
	publishReload,
	publicHealthy,
	RELOAD_DEBOUNCE_MS,
	RELOAD_ENV,
	RELOAD_FILE,
	reloadGate,
	watchPublic,
} from "./reload.ts";

async function waitFor(check: () => Promise<boolean>, ms = 2500): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return true;
		await Bun.sleep(40);
	}
	return false;
}

describe("plain-HTML dev reload", () => {
	test("the signal names match the bridge and the page listener", () => {
		expect(DEV_RELOAD_EVENT).toBe("dev:reload");
		expect(RELOAD_ENV).toBe("CRUST_DEV_RELOAD_FILE");
		expect(RELOAD_FILE).toBe(".crust/dev-reload");
	});

	test("a change only reloads without a dev server and with a readable document", () => {
		expect(reloadGate(undefined, true)).toBe(true);
		expect(reloadGate("http://localhost:5173", true)).toBe(false);
		expect(reloadGate(undefined, false)).toBe(false);
	});

	test("an empty or missing document is a failed rebuild", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-dev-reload-"));
		try {
			const publicDir = join(dir, "public");
			await mkdir(publicDir);
			expect(await publicHealthy(publicDir)).toBe(false);
			await writeFile(join(publicDir, "index.html"), "  ");
			expect(await publicHealthy(publicDir)).toBe(false);
			await writeFile(join(publicDir, "index.html"), "<html></html>");
			expect(await publicHealthy(publicDir)).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("dev.url installs no watcher at all", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-dev-reload-"));
		try {
			await mkdir(join(dir, "public"));
			expect(watchPublic(dir, "http://localhost:5173", async () => {})).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a healthy change advances the token; a break in public/ does not", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-dev-reload-"));
		const publicDir = join(dir, "public");
		const signal = join(dir, RELOAD_FILE);
		try {
			await mkdir(publicDir);
			await writeFile(join(publicDir, "index.html"), "<html></html>");
			expect(await publicHealthy(publicDir)).toBe(true);
			await publishReload(signal, "0");

			let token = 0;
			const watcher = watchPublic(dir, undefined, async () => {
				await publishReload(signal, String(++token));
			});
			expect(watcher).not.toBeUndefined();
			// Let the native watch settle before the first write.
			await Bun.sleep(150);
			await writeFile(join(publicDir, "app.js"), "// one");
			expect(await waitFor(async () => (await readFile(signal, "utf8")) === "1")).toBe(true);

			await unlink(join(publicDir, "index.html"));
			expect(await publicHealthy(publicDir)).toBe(false);
			await writeFile(join(publicDir, "app.js"), "// two");
			await Bun.sleep(RELOAD_DEBOUNCE_MS + 300);
			expect(await readFile(signal, "utf8")).toBe("1");
			watcher?.close();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
