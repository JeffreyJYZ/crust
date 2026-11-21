/**
 * `crust:pty` on Windows: ConPTY as the pty `Bun.Terminal` cannot be.
 *
 * The C unit (`shim/63_pty.c` + `64_pty_io.c`) owns the pseudo-console, two pipe pairs and a reader
 * thread; this file turns that into the plugin's `PtyBackend`: open one slot, poll its ring, type
 * into it, resize it, and close it so no conhost outlives the app.
 *
 * Polled, not callback: `ReadFile` on a console pipe blocks until the child writes, and the only
 * thread JavaScript may block is none of them. 20 ms is one frame at 50 Hz — a keystroke echo lands
 * well inside the time a person can notice, and an idle terminal costs one shim call per tick.
 */
import { ptr } from "bun:ffi";
import type { PtyBackend, PtyOpenRequest, PtyTerminal } from "@/plugins/pty-backend";
import { cstring } from "./cstring.ts";
import { conptyShim, type WindowsPtyShim } from "./pty-ffi.ts";

/** One read's ceiling, matching `PTY_FRAME_BYTES`: a flood becomes many frames, not one giant one. */
const READ_BYTES = 8192;
/** One tick at 50 Hz. */
const POLL_MS = 20;

/** Why `open` refused, in the C's own words — a machine missing an export names the export. */
function refuseOpen(shim: WindowsPtyShim): string {
	const missing = shim.shim_pty_missing();
	if (missing) return `ConPTY is not available: kernel32!${missing} did not resolve`;
	const reason = shim.shim_pty_reason() ?? "shim_pty_open refused without a reason";
	const code = Number(shim.shim_pty_last_error());
	return code === 0 ? reason : `${reason} [${code}]`;
}

function openTerminal(shim: WindowsPtyShim, request: PtyOpenRequest): PtyTerminal {
	if (Number(shim.shim_pty_load()) !== 1) throw new Error(refuseOpen(shim));
	const index = Number(
		shim.shim_pty_open(
			cstring(request.shell),
			cstring(request.cwd),
			request.cols,
			request.rows,
		),
	);
	if (index < 0) throw new Error(refuseOpen(shim));
	const pid = Number(shim.shim_pty_pid(index));
	if (pid <= 0) {
		shim.shim_pty_close(index);
		throw new Error("ConPTY opened a console whose process has no pid");
	}
	let closed = false;
	let finished = false;
	let code: number | null = null;
	let resolveExit: (value: number) => void = () => {};
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const buffer = new Uint8Array(READ_BYTES);

	// Everything the reader thread has collected, in order; a page that stops polling loses the
	// oldest bytes in the C ring rather than blocking the console.
	const drain = (): void => {
		for (;;) {
			const got = Number(shim.shim_pty_read(index, ptr(buffer), READ_BYTES));
			if (got <= 0) return;
			request.onData(buffer.slice(0, got));
		}
	};

	const finish = (): void => {
		if (finished) return;
		finished = true;
		drain();
		code = Number(shim.shim_pty_exit_code(index));
		resolveExit(code);
		clearInterval(timer);
	};

	const tick = (): void => {
		drain();
		if (Number(shim.shim_pty_state(index)) === 1) finish();
	};
	const timer = setInterval(tick, POLL_MS);
	// A pty does not by itself keep the process alive: the app's own window and bridge do.
	timer.unref?.();

	return {
		pid,
		get closed() {
			return closed;
		},
		get exitCode() {
			return code;
		},
		// Windows ends a process with an exit code, never a POSIX signal.
		signalCode: null,
		exited,
		write: (data) => {
			const bytes = Buffer.from(data, "utf8");
			const wrote = Number(shim.shim_pty_write(index, bytes, bytes.length));
			if (wrote < 0) throw new Error(shim.shim_pty_reason() ?? "the console refused a write");
			return wrote;
		},
		resize: (cols, rows) => {
			if (Number(shim.shim_pty_resize(index, cols, rows)) !== 1) {
				throw new Error(shim.shim_pty_reason() ?? "the console refused a resize");
			}
		},
		close: () => {
			if (closed) return;
			// Before the close, so `pty-exit` still carries the child's status rather than -1.
			finish();
			closed = true;
			shim.shim_pty_close(index);
		},
		kill: () => {
			if (!finished) shim.shim_pty_kill(index);
		},
	};
}

/**
 * The backend the Windows arm of `featurePlugins` passes to `createPtyPlugin`. `load` is a
 * parameter so the adapter is testable against a fake symbol table off Windows.
 */
export function windowsPtyBackend(load: () => WindowsPtyShim = conptyShim): PtyBackend {
	return { open: (request) => openTerminal(load(), request) };
}
