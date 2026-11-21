/**
 * What `crust:pty` promises a page, proved against a real pty rather than a stand-in: a shell that
 * reports a real window size, bytes arriving as base64 frames that decode back to what the shell
 * wrote, a resize the shell sees, the child's own exit status, and a close that leaves no pid behind.
 * The terminal is `Bun.Terminal`, so these are the same bytes a terminal window would render.
 */
import { describe, expect, test } from "bun:test";
import { liveChildren } from "@/child-reap";
import { createPtyPlugin } from "@/plugins/pty";

const SHELL = "/bin/sh";

function fixture() {
	const frames: string[] = [];
	const exits: Array<{ id: string; exitCode: number | null; signal: string | null }> = [];
	const plugin = createPtyPlugin({ shell: SHELL }, "darwin");
	const ctx = {
		emit: (event: string, data: unknown): void => {
			if (event === "pty-data") frames.push((data as { chunk: string }).chunk);
			if (event === "pty-exit") exits.push(data as (typeof exits)[number]);
		},
	};
	const text = (): string =>
		Buffer.concat(frames.map((chunk) => Buffer.from(chunk, "base64"))).toString("utf8");
	const waitFor = async (needle: string, ms = 5000): Promise<boolean> => {
		const deadline = performance.now() + ms;
		while (performance.now() < deadline) {
			if (text().includes(needle)) return true;
			await Bun.sleep(25);
		}
		return false;
	};
	const open = (args: object = {}): string => {
		const answer = plugin.commands.open({ cols: 90, rows: 20, ...args }, ctx);
		expect(answer).toMatchObject({ ok: true });
		return (answer as { id: string }).id;
	};
	return { plugin, ctx, frames, exits, text, waitFor, open };
}

/** Poll a pid until it is gone, because a signal takes a moment to be reaped. */
async function gone(pid: number, ms = 3000): Promise<boolean> {
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await Bun.sleep(25);
	}
	return false;
}

describe("crust:pty", () => {
	test("a real shell reports the size the page asked for", async () => {
		const pty = fixture();
		const id = pty.open({ cols: 90, rows: 20 });
		pty.plugin.commands.write({ id, data: "stty size\n" });
		expect(await pty.waitFor("20 90")).toBe(true);
		pty.plugin.commands.close({ id });
	});

	test("bytes arrive as base64 frames that decode back to the output", async () => {
		const pty = fixture();
		const id = pty.open();
		pty.plugin.commands.write({ id, data: "echo marker-$((6*7))\n" });
		expect(await pty.waitFor("marker-42")).toBe(true);
		// Base64, not a decoded string: the page must decode, so the frame is never valid UTF-8 text
		// for a multi-byte read and the transport stays byte-exact.
		expect(pty.frames.every((chunk) => /^[A-Za-z0-9+/=]+$/.test(chunk))).toBe(true);
		expect(pty.text()).toContain("marker-42");
		pty.plugin.commands.close({ id });
	});

	test("resize is visible to the program inside", async () => {
		const pty = fixture();
		const id = pty.open({ cols: 100, rows: 30 });
		pty.plugin.commands.write({ id, data: "stty size\n" });
		expect(await pty.waitFor("30 100")).toBe(true);
		expect(pty.plugin.commands.resize({ id, cols: 120, rows: 40 })).toMatchObject({ ok: true });
		pty.plugin.commands.write({ id, data: "stty size\n" });
		expect(await pty.waitFor("40 120")).toBe(true);
		pty.plugin.commands.close({ id });
	});

	test("the exit event carries the child's own status, not the pty's", async () => {
		const pty = fixture();
		const id = pty.open();
		pty.plugin.commands.write({ id, data: "exit 3\n" });
		const deadline = performance.now() + 5000;
		while (pty.exits.length === 0 && performance.now() < deadline) await Bun.sleep(25);
		expect(pty.exits[0]).toMatchObject({ id, exitCode: 3 });
		// A shell that exited on its own is closed and pruned, so `list` does not lie about it.
		await Bun.sleep(25);
		expect(pty.plugin.commands.list().ids).not.toContain(id);
	});

	test("close leaves no child behind and empties the reap set", async () => {
		const pty = fixture();
		const answer = pty.plugin.commands.open({ cols: 80, rows: 24 }, pty.ctx);
		const { id, pid } = answer as { id: string; pid: number };
		pty.plugin.commands.write({ id, data: "echo up\n" });
		expect(await pty.waitFor("up")).toBe(true);
		expect(pty.plugin.commands.close({ id })).toMatchObject({ ok: true, closed: true });
		expect(await gone(pid)).toBe(true);
		expect(liveChildren()).toBe(0);
	});

	test("a closed handle refuses by name instead of throwing", () => {
		const pty = fixture();
		const id = pty.open();
		pty.plugin.commands.close({ id });
		expect(pty.plugin.commands.write({ id, data: "x" })).toMatchObject({
			ok: false,
			code: "terminal-closed",
		});
		expect(pty.plugin.commands.write({ id: "nope", data: "x" })).toMatchObject({
			ok: false,
			code: "unknown-terminal",
		});
	});

	test("a malformed size is refused, never a spawn on garbage", () => {
		const pty = fixture();
		expect(pty.plugin.commands.open({ cols: "big" } as never, pty.ctx)).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
		expect(pty.plugin.commands.write({ id: "", data: "x" })).toMatchObject({
			ok: false,
			code: "invalid-args",
		});
	});
});
