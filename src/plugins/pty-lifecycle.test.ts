/**
 * Plugin-side pty edges that a platform stand-in can prove deterministically: a natural exit must
 * close and unlist its handle, a page-initiated close must not echo a fabricated child status, a
 * write cap must count UTF-8 bytes, a fractional size must be refused, and a flood must not enqueue
 * an unbounded number of frames. The ConPTY shim half is a separate lane.
 */
import { describe, expect, test } from "bun:test";
import { createPtyPlugin } from "@/plugins/pty";
import { fakePty, ptyEvents } from "@/plugins/pty-fake";

const ctx = {
	emit: (): void => {},
};

function open(
	pty: ReturnType<typeof fakePty>,
	emit: (event: string, data: unknown) => void = ctx.emit,
) {
	const plugin = createPtyPlugin({}, "win32", pty.backend);
	const answer = plugin.commands.open({ cols: 80, rows: 24 }, { emit });
	return { plugin, id: (answer as { id: string }).id };
}

describe("pty lifecycle and bounds", () => {
	test("a page close reports a termination, never the shim's fabricated exit code 0", async () => {
		const pty = fakePty();
		const sink = ptyEvents();
		const { plugin, id } = open(pty, sink.ctx.emit);
		// The fake's `finish(0)` is what `finish()` in pty-conpty.ts reads before TerminateProcess.
		pty.finish(0);
		plugin.commands.close({ id });
		await Promise.resolve();
		await Promise.resolve();
		expect(sink.events.find((entry) => entry.event === "pty-exit")?.data).toMatchObject({
			id,
			exitCode: null,
			signal: "SIGTERM",
		});
	});

	test("a naturally exited terminal leaves the list and closes its handle", async () => {
		const pty = fakePty();
		const { plugin, id } = open(pty);
		expect(plugin.commands.list().ids).toContain(id);
		pty.finish(3);
		await Promise.resolve();
		await Promise.resolve();
		expect(pty.closes).toBe(1);
		expect(plugin.commands.list().ids).not.toContain(id);
		expect(plugin.commands.write({ id, data: "x" })).toMatchObject({
			ok: false,
			code: "terminal-closed",
		});
	});

	test("a write cap counts UTF-8 bytes, not UTF-16 code units", () => {
		const pty = fakePty();
		const { plugin, id } = open(pty);
		// 40,000 CJK chars are 40,000 code units but 120,000 UTF-8 bytes: past the 64 KiB cap.
		expect(plugin.commands.write({ id, data: "中".repeat(40_000) })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
		expect(pty.writes).toEqual([]);
	});

	test("a fractional size is refused rather than silently floored", () => {
		const pty = fakePty();
		const plugin = createPtyPlugin({}, "win32", pty.backend);
		expect(plugin.commands.open({ cols: 80.7, rows: 24 }, ctx)).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
		expect(pty.requests).toEqual([]);
	});

	test("a flood is coalesced into a bounded number of frames, with no bytes lost", () => {
		const pty = fakePty();
		const frames: string[] = [];
		const { plugin } = open(pty, (event, data) => {
			if (event === "pty-data") frames.push((data as { chunk: string }).chunk);
		});
		const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251);
		pty.data(bytes);
		expect(frames.length).toBeLessThanOrEqual(8);
		expect(Buffer.concat(frames.map((chunk) => Buffer.from(chunk, "base64")))).toEqual(
			Buffer.from(bytes),
		);
	});
});
