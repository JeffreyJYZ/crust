/**
 * The stand-in ConPTY backend shared by the Windows arm test and the plugin lifecycle tests. It runs
 * on macOS: the real console is proven on a Windows runner (`scripts/windows/pty.ts`), and what these
 * tests own is the plugin's side of the contract — frames, lifecycle, argument readers and handle map.
 */

import type { PtyBackend, PtyOpenRequest, PtyTerminal } from "./pty-backend";

export interface FakePty {
	backend: PtyBackend;
	requests: PtyOpenRequest[];
	writes: string[];
	resized: Array<{ cols: number; rows: number }>;
	closes: number;
	data(bytes: Uint8Array): void;
	finish(code: number): void;
}

export function fakePty(): FakePty {
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
	};
}

/** A context that records emitted events, for assertions on `pty-data` and `pty-exit`. */
export function ptyEvents(): {
	ctx: { emit(event: string, data: unknown): void };
	events: Array<{ event: string; data: unknown }>;
} {
	const events: Array<{ event: string; data: unknown }> = [];
	return {
		ctx: {
			emit: (event, data) => void events.push({ event, data }),
		},
		events,
	};
}
