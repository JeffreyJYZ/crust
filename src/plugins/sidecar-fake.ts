/**
 * A fake sidecar child for the plugin suite: a `Bun.spawn` stand-in whose stdout/stderr are
 * pushable streams and whose exit promise is controlled by the test. No real binary is executed,
 * so a test can end a process mid-stream and still assert the exit event.
 */

import type { SidecarChild, SidecarSpawner } from "./sidecar";

export interface FakeSidecar {
	spawn: SidecarSpawner;
	/** argv the last spawn was handed. */
	calls: string[][];
	/** Push a chunk to stdout, as the program would. */
	out(text: string): void;
	/** Push a chunk to stderr. */
	err(text: string): void;
	/** End the process with an exit code. */
	exit(code: number): Promise<void>;
	/** End with a signal and no exit code. */
	signal(name: string): Promise<void>;
}

interface Pushable {
	stream: ReadableStream<Uint8Array>;
	push(chunk: Uint8Array): void;
	close(): void;
}

function pushable(): Pushable {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	return {
		stream,
		push: (chunk) => controller.enqueue(chunk),
		close: () => controller.close(),
	};
}

const encoder = new TextEncoder();

/** A fake whose child reports `pid` 4242 and waits for the test to end it. */
export function fakeSidecar(pid = 4242): FakeSidecar {
	const calls: string[][] = [];
	const enc = encoder;
	let out = pushable();
	let err = pushable();
	let exitCode: number | null = null;
	let signalCode: string | null = null;
	let settle!: (code: number) => void;
	const exited = new Promise<number>((done) => {
		settle = done;
	});
	const child: SidecarChild = {
		pid,
		get stdout() {
			return out.stream;
		},
		get stderr() {
			return err.stream;
		},
		exited,
		get exitCode() {
			return exitCode;
		},
		get signalCode() {
			return signalCode;
		},
		kill(sig) {
			signalCode = String(sig ?? "SIGTERM");
			exitCode = null;
			settle(0);
		},
	};
	const end = async (code: number, signal: string | null): Promise<void> => {
		exitCode = signal === null ? code : null;
		signalCode = signal;
		out.close();
		err.close();
		settle(code);
		await exited;
	};
	return {
		calls,
		spawn: (cmd) => {
			calls.push([...cmd]);
			return child;
		},
		out: (value) => out.push(enc.encode(value)),
		err: (value) => err.push(enc.encode(value)),
		exit: (code) => end(code, null),
		signal: (name) => end(0, name),
	};
}
