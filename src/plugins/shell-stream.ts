/**
 * `crust:shell`'s output plumbing: a bounded line ring per stream, the drain that fills it, and the liveness test `output`, `kill` and `list` share.
 * A ring is also the emit budget, so a chatty program can never turn streaming into an unbounded event flood.
 */

import { constants } from "node:os";

export const SHELL_OUTPUT_LINES = 500; // per stream; older lines drop, so a chatty program cannot grow it
const MAX_LINE = 8192; // a longer line is flushed in pieces, so a stream with no newline stays bounded

export type LineRing = {
	/** Keep a line; answer it as kept while the ring still has room, else `undefined`. */
	push(line: string): string | undefined;
	lines(): string[];
};

export function createLineRing(limit = SHELL_OUTPUT_LINES): LineRing {
	const kept: string[] = [];
	return {
		push(line) {
			const stored = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
			if (kept.length >= limit) {
				kept.shift();
				kept.push(stored);
				return undefined;
			}
			kept.push(stored);
			return stored;
		},
		lines: () => [...kept],
	};
}

/** A process whose stdin may be a pipe, depending on what `spawn` asked for. */
export type Child = Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;

/** The page-facing sink `spawn` takes from its plugin context. */
export type Emit = (event: string, data: unknown) => void;

/** One `shell-output` payload: which process, which stream, and the line as kept. */
export interface ShellLine {
	id: string;
	stream: "stdout" | "stderr";
	line: string;
}

/** The per-line sink `spawn` hands the drain, or `undefined` when no page is listening. */
export function lineSink(
	emit: Emit | undefined,
	id: string,
	stream: ShellLine["stream"],
): ((line: string) => void) | undefined {
	if (emit === undefined) return undefined;
	return (line: string): void => emit("shell-output", { id, stream, line } satisfies ShellLine);
}

/** Read one stream to its end, keeping only complete lines in the ring and handing each kept one to `onKept`. */
export async function drain(
	stream: Child["stdout"],
	ring: LineRing,
	onKept?: (line: string) => void,
): Promise<void> {
	const keep = (line: string): void => {
		const stored = ring.push(line);
		if (stored !== undefined && onKept) onKept(stored);
	};
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let partial = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		partial += decoder.decode(value, { stream: true });
		const rows = partial.split("\n");
		partial = rows.pop() ?? "";
		for (const row of rows) keep(row);
		if (partial.length > MAX_LINE) {
			keep(partial);
			partial = "";
		}
	}
	partial += decoder.decode();
	if (partial.length > 0) keep(partial);
}

/** A killed process reports a signal and no exit code, so either one means it is gone. */
export function finished(child: Child): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

/** Bun names a signal, or reports a raw number when it has no name. */
export function signalName(signal: Child["signalCode"]): string | null {
	if (signal === null || typeof signal === "string") return signal;
	const named = Object.entries(constants.signals).find(([, value]) => value === signal);
	return named ? named[0] : String(signal);
}
