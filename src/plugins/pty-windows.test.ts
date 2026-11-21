/**
 * `crust:pty` on the Windows arm: the plugin hands every command to the ConPTY backend it was
 * given, and keeps the parts a platform does not decide — base64 frames, the child's own exit
 * status, the handle map, and the reap.
 *
 * The backend here is a stand-in, so this test runs on macOS. The real console and its shell are
 * proven on a Windows runner (`scripts/windows/pty.ts`); what is proven here is that the plugin
 * never reaches for `Bun.Terminal` on `win32`.
 */
import { describe, expect, test } from "bun:test";
import { createPtyPlugin } from "@/plugins/pty";
import type { PtyBackend, PtyOpenRequest, PtyTerminal } from "@/plugins/pty-backend";

interface Fake {
	backend: PtyBackend;
	requests: PtyOpenRequest[];
	writes: string[];
	resized: Array<{ cols: number; rows: number }>;
	closes: number;
	data(bytes: Uint8Array): void;
	finish(code: number): void;
}

function fake(): Fake {
	const requests: PtyOpenRequest[] = [];
	const writes: string[] = [];
	const resized: Array<{ cols: number; rows: number }> = [];
	let closes = 0;
	let resolveExit: (code: number) => void = () => {};
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	let request: PtyOpenRequest | undefined;
	let code: number | null = null;
	const terminal: PtyTerminal = {
		pid: 777,
		get closed() {
			return closes > 0;
		},
		get exitCode() {
			return code;
		},
		signalCode: null,
		exited,
		write: (data) => {
			writes.push(data);
			return Buffer.byteLength(data, "utf8");
		},
		resize: (cols, rows) => void resized.push({ cols, rows }),
		close: () => void (closes += 1),
		kill: () => {},
	};
	return {
		backend: {
			open: (asked) => {
				requests.push(asked);
				request = asked;
				return terminal;
			},
		},
		requests,
		writes,
		resized,
		get closes() {
			return closes;
		},
		data: (bytes) => request?.onData(bytes),
		finish: (value) => {
			code = value;
			resolveExit(value);
		},
	} as Fake;
}

const ctx = {
	emit: (): void => {},
};

describe("the Windows arm", () => {
	test("open answers the backend's pid and never a refusal", () => {
		const pty = fake();
		const plugin = createPtyPlugin(
			{ shell: "C:\\Windows\\system32\\cmd.exe" },
			"win32",
			pty.backend,
		);
		const opened = plugin.commands.open({ cols: 100, rows: 30 }, ctx);
		expect(opened).toMatchObject({ ok: true, pid: 777 });
		expect(pty.requests[0]).toMatchObject({ cols: 100, rows: 30 });
		expect(pty.requests[0]?.shell.endsWith("cmd.exe")).toBe(true);
	});

	test("bytes become base64 pty-data frames and the exit event carries the child's code", async () => {
		const pty = fake();
		const events: Array<{ event: string; data: unknown }> = [];
		const plugin = createPtyPlugin({}, "win32", pty.backend);
		const opened = plugin.commands.open(
			{ cols: 80, rows: 24 },
			{
				emit: (event, data) => void events.push({ event, data }),
			},
		);
		const id = (opened as { id: string }).id;
		pty.data(Uint8Array.from([0x68, 0x69, 0x0a]));
		const frame = events.find((entry) => entry.event === "pty-data");
		expect(frame?.data).toEqual({ id, chunk: Buffer.from("hi\n").toString("base64") });
		pty.finish(3);
		await Promise.resolve();
		await Promise.resolve();
		expect(events.find((entry) => entry.event === "pty-exit")?.data).toMatchObject({
			id,
			exitCode: 3,
			signal: null,
		});
	});

	test("write, resize and close reach the backend and leave the handle list", () => {
		const pty = fake();
		const plugin = createPtyPlugin({}, "win32", pty.backend);
		const id = (plugin.commands.open({ cols: 80, rows: 24 }, ctx) as { id: string }).id;
		expect(plugin.commands.list().ids).toContain(id);
		expect(plugin.commands.write({ id, data: "dir\r\n" })).toEqual({ ok: true, bytes: 5 });
		expect(pty.writes).toEqual(["dir\r\n"]);
		expect(plugin.commands.resize({ id, cols: 120, rows: 40 })).toMatchObject({ ok: true });
		expect(pty.resized).toEqual([{ cols: 120, rows: 40 }]);
		expect(plugin.commands.close({ id })).toMatchObject({ ok: true, closed: true });
		expect(pty.closes).toBe(1);
		expect(plugin.commands.list().ids).not.toContain(id);
		expect(plugin.commands.write({ id, data: "x" })).toMatchObject({
			ok: false,
			code: "terminal-closed",
		});
	});

	test("a backend that throws on open is a typed spawn-failed, not a throw", () => {
		const backend: PtyBackend = {
			open: () => {
				throw new Error("CreateProcessW returned FALSE (GetLastError 2)");
			},
		};
		const plugin = createPtyPlugin({}, "win32", backend);
		expect(plugin.commands.open({ cols: 80, rows: 24 }, ctx)).toMatchObject({
			ok: false,
			code: "spawn-failed",
		});
	});
});
