/**
 * The ConPTY adapter against a fake symbol table: the parts of it that can be wrong off Windows.
 *
 * The real console is proven on a Windows runner (`scripts/windows/pty.ts`). What is proven here is
 * the contract around it — a missing export is named rather than called, the ring is drained in
 * order and copied, the child's own exit code is what `exited` answers, and a refused write or
 * resize is a throw the plugin turns into `terminal-closed` rather than a silent no-op.
 */
import { describe, expect, test } from "bun:test";
import { at } from "./fake-bytes.ts";
import type { WindowsPtyShim } from "./pty-ffi.ts";
import { windowsPtyBackend } from "./pty-conpty.ts";

interface Fake extends WindowsPtyShim {
	calls: string[];
	chunks: Uint8Array[];
	states: number[];
	written: Uint8Array[];
	envBlocks: string[];
}

function fake(overrides: Partial<WindowsPtyShim> = {}): Fake {
	const calls: string[] = [];
	const chunks: Uint8Array[] = [];
	const states: number[] = [];
	const written: Uint8Array[] = [];
	const envBlocks: string[] = [];
	const shim: Fake = {
		calls,
		chunks,
		states,
		written,
		envBlocks,
		shim_pty_load: () => 1,
		shim_pty_ready: () => 1,
		shim_pty_missing: () => "",
		shim_pty_reason: () => "the stub's reason",
		shim_pty_last_error: () => 0,
		shim_pty_open: (shell, args, cwd, env) => {
			calls.push(
				`open ${Buffer.from(shell).toString("utf8")} ${Buffer.from(args).toString("utf8")} ` +
					Buffer.from(cwd).toString("utf8"),
			);
			envBlocks.push(Buffer.from(env).toString("utf16le"));
			return 0;
		},
		shim_pty_pid: () => 4242,
		shim_pty_read: (_index, dst, cap) => {
			const next = chunks[0];
			if (next === undefined) return 0;
			const take = Math.min(cap, next.length);
			at(dst, take).set(next.subarray(0, take));
			if (take === next.length) chunks.shift();
			else chunks[0] = next.subarray(take);
			return take;
		},
		shim_pty_write: (_index, data, length) => {
			written.push(Uint8Array.from(data.subarray(0, length)));
			return length;
		},
		shim_pty_resize: () => 1,
		shim_pty_state: () => (states.length > 0 ? (states.shift() as number) : 0),
		shim_pty_total: () => 0,
		shim_pty_exit_code: () => 7,
		shim_pty_kill: () => 1,
		shim_pty_close: () => {
			calls.push("close");
			return 1;
		},
		...overrides,
	};
	return shim;
}

const request = {
	shell: "C:\\Windows\\system32\\cmd.exe",
	cols: 100,
	rows: 30,
	cwd: "C:\\Users\\crust",
	env: {},
	onData: () => {},
};

/** Wait for a condition a timer drives, bounded so a stuck poll fails rather than hangs. */
async function until(check: () => boolean, ms = 2000): Promise<boolean> {
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		if (check()) return true;
		await Bun.sleep(20);
	}
	return check();
}

describe("opening", () => {
	test("a machine without the export is refused by its name, not called", () => {
		const shim = fake({
			shim_pty_load: () => 0,
			shim_pty_missing: () => "CreatePseudoConsole",
		});
		expect(() => windowsPtyBackend(() => shim).open(request)).toThrow(
			"kernel32!CreatePseudoConsole did not resolve",
		);
	});

	test("a console the shim refuses carries the reason and the Win32 code", () => {
		const shim = fake({ shim_pty_open: () => -1, shim_pty_last_error: () => 87 });
		expect(() => windowsPtyBackend(() => shim).open(request)).toThrow("the stub's reason [87]");
	});

	test("the shell and cwd reach the shim as NUL-terminated UTF-8, and the pid is the child's", () => {
		const shim = fake();
		const terminal = windowsPtyBackend(() => shim).open(request);
		expect(terminal.pid).toBe(4242);
		expect(shim.calls[0]).toBe(`open ${request.shell}\0 \0 ${request.cwd}\0`);
		terminal.close();
	});

	/**
	 * The plugin builds the whole environment with TERM. Passing 0 to CreateProcessW used to discard
	 * it, so a shell inside crust had no terminal type even though the page asked for one.
	 */
	test("the plugin's environment reaches the shim as a sorted double-NUL UTF-16 block", () => {
		const shim = fake();
		const terminal = windowsPtyBackend(() => shim).open({
			...request,
			env: { TERM: "xterm-256color", PATH: "C:\\bin" },
		});
		expect(shim.envBlocks[0]).toBe("PATH=C:\\bin\0TERM=xterm-256color\0\0");
		terminal.close();
	});
});

describe("the stream", () => {
	test("bytes arrive as copies, in order, and never decoded", async () => {
		const shim = fake();
		const seen: Uint8Array[] = [];
		shim.chunks.push(Uint8Array.from([0x1b, 0x5b]), Uint8Array.from([0xff, 0x00]));
		const terminal = windowsPtyBackend(() => shim).open({
			...request,
			onData: (bytes) => seen.push(bytes),
		});
		expect(await until(() => seen.length === 2)).toBe(true);
		expect(seen.map((bytes) => [...bytes])).toEqual([
			[0x1b, 0x5b],
			[0xff, 0x00],
		]);
		// A copy, not a view of the adapter's reused buffer.
		expect(seen[0]).not.toBe(seen[1]);
		terminal.close();
	});

	test("the child's own exit code is what `exited` answers", async () => {
		const shim = fake();
		shim.states.push(0, 1);
		const terminal = windowsPtyBackend(() => shim).open(request);
		expect(await terminal.exited).toBe(7);
		expect(terminal.exitCode).toBe(7);
		// Windows ends a process with a code, never a POSIX signal.
		expect(terminal.signalCode).toBe(null);
		terminal.close();
	});
});

describe("the calls a page makes", () => {
	test("write sends UTF-8 bytes and answers how many were accepted", () => {
		const shim = fake();
		const terminal = windowsPtyBackend(() => shim).open(request);
		expect(terminal.write("echo héllo\r\n")).toBe(13);
		expect(Buffer.from(shim.written[0] as Uint8Array).toString("utf8")).toBe("echo héllo\r\n");
		terminal.close();
	});

	test("a refused write and a refused resize throw the shim's reason", () => {
		const shim = fake({ shim_pty_write: () => -1, shim_pty_resize: () => 0 });
		const terminal = windowsPtyBackend(() => shim).open(request);
		expect(() => terminal.write("x")).toThrow("the stub's reason");
		expect(() => terminal.resize(80, 24)).toThrow("the stub's reason");
		terminal.close();
	});

	test("close is idempotent and releases the slot once", () => {
		const shim = fake();
		const terminal = windowsPtyBackend(() => shim).open(request);
		terminal.close();
		terminal.close();
		expect(terminal.closed).toBe(true);
		expect(shim.calls.filter((call) => call === "close")).toHaveLength(1);
	});
});
