/**
 * The dev signal file as a bridge event: one frame per token change, and nothing
 * when the token is empty or unchanged (a failed rebuild writes no token).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_RELOAD_EVENT, Events, RELOAD_ENV } from "./events.ts";
import { SseReader } from "./fixtures.ts";

afterEach(() => {
	delete process.env[RELOAD_ENV];
});

/**
 * The wait is generous on purpose: this asserts a frame arrives, and under a full-suite run the event
 * loop is shared with every other test, so a tight bound measures the machine's load rather than the
 * watcher. A real failure still fails — it just takes longer to say so.
 */
async function next(reader: SseReader, ms = 5000) {
	return await Promise.race([reader.next(), Bun.sleep(ms).then(() => null)]);
}

function scratch(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "crust-reload-"));
	return { dir, file: join(dir, "dev-reload") };
}

describe("dev reload signal", () => {
	test("a changed token emits exactly one dev:reload frame", async () => {
		const { dir, file } = scratch();
		try {
			writeFileSync(file, "0");
			process.env[RELOAD_ENV] = file;
			const events = new Events();
			const reader = new SseReader(events.stream(1).body as ReadableStream<Uint8Array>);
			expect((await next(reader))?.event).toBe("crust:ready");

			writeFileSync(file, "1");
			const frame = await next(reader);
			expect(frame?.event).toBe(DEV_RELOAD_EVENT);
			expect(typeof JSON.parse(frame?.data ?? "null").at).toBe("number");

			events.stop();
			await reader.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an empty token never emits", async () => {
		const { dir, file } = scratch();
		try {
			writeFileSync(file, "0");
			process.env[RELOAD_ENV] = file;
			const events = new Events();
			const reader = new SseReader(events.stream(1).body as ReadableStream<Uint8Array>);
			expect((await next(reader))?.event).toBe("crust:ready");

			// An empty token must never reach a page, so this waits a short bounded time and expects
			// nothing — the opposite assertion to the one above, and it must not wait the full budget
			// for a frame that correctly never comes.
			writeFileSync(file, "");
			expect(await next(reader, 600)).toBeNull();

			events.stop();
			await reader.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
