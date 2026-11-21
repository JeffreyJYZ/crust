/**
 * `Bun.Terminal` as the POSIX pty: no libc bound, no `openpty` (measured on Bun 1.4.5).
 *
 * `Bun.spawn` attaches the terminal, so the child's stdin/stdout/stderr are the pty and `stty size`
 * answers the size the page asked for. The terminal's own `exit` callback is the pty lifecycle (0
 * EOF, 1 error), never the child's status, so `exited` stays the subprocess's own promise.
 */

import type { PtyBackend, PtyOpenRequest, PtyTerminal } from "./pty-backend";

function terminal(request: PtyOpenRequest): PtyTerminal {
	const term = new Bun.Terminal({
		cols: request.cols,
		rows: request.rows,
		name: "xterm-256color",
		data: (_term, bytes) => void request.onData(bytes),
	});
	let child: Bun.Subprocess;
	try {
		child = Bun.spawn({
			cmd: [request.shell],
			cwd: request.cwd,
			env: request.env,
			terminal: term,
		});
	} catch (error) {
		term.close();
		throw error;
	}
	let closed = false;
	return {
		pid: child.pid,
		get closed() {
			return closed || term.closed;
		},
		get exitCode() {
			return child.exitCode;
		},
		get signalCode() {
			return child.signalCode;
		},
		exited: child.exited,
		write: (data) => term.write(data),
		resize: (cols, rows) => term.resize(cols, rows),
		close: () => {
			// Closing the master hangs the pty up, which ends a cooperating shell; a program that
			// traps SIGHUP is why the kill is here rather than left to the kernel.
			try {
				term.close();
			} catch {
				// Already closed under us; the close the page asked for still happened.
			}
			closed = true;
			if (child.exitCode === null) child.kill("SIGTERM");
		},
		kill: (signal) => {
			if (child.exitCode === null) child.kill(signal as never);
		},
	};
}

/** The pty every platform but Windows has, through Bun's own terminal. */
export function posixPtyBackend(): PtyBackend {
	return { open: terminal };
}
