/**
 * `crust:pty` — a real pseudo-terminal a page drives: open a shell, write keystrokes, read its bytes, resize, close.
 *
 * The pty itself is the platform's: `Bun.Terminal` on POSIX (`pty-posix.ts`) and a ConPTY shim on
 * Windows (`platform/windows/pty-conpty.ts`). This file owns the handles, the argument readers and
 * the two events, so neither platform's spawn rule leaks into the other.
 * The host's `pty.shell` is what may run: a page's `program` is accepted only when it is that same
 * program, because an unconstrained login shell reachable from the webview is local command execution.
 * Every child goes through `child-reap`, so a terminal cannot outlive `quit()` or a dev restart's SIGTERM.
 */

import { installReapOnExit, trackChild } from "../child-reap.ts";
import {
	definePlugin,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import { type OpenArgs, readId, readOpen, readResize, readWrite } from "./pty-args";
import { type PtyBackend, type PtyTerminal } from "./pty-backend";
import { hostShell, sameProgram, windowsRefusal } from "./pty-host";
import { posixPtyBackend } from "./pty-posix";
import { frameSink } from "./pty-stream";
import {
	isPtyFailure,
	type PtyExit,
	type PtyFailure,
	type PtyOptions,
	ptyFailure,
} from "./pty-types";
import { signalName } from "./shell-stream";

/** What `signalName` reads: Bun's own `Signals` union, which a backend may answer as a plain string. */
type SignalCode = Parameters<typeof signalName>[0];

export type { PtyData, PtyExit, PtyFailure, PtyOptions } from "./pty-types";
export type { PtyBackend, PtyTerminal } from "./pty-backend";

const MAX_RECORDS = 64; // a closed handle keeps answering `terminal-closed` until this cap prunes it

export type OpenOutcome = { ok: true; id: string; pid: number } | PtyFailure | NotImplemented;
export type WriteOutcome = { ok: true; bytes: number } | PtyFailure;
export type ResizeOutcome = { ok: true; id: string; cols: number; rows: number } | PtyFailure;
export type CloseOutcome = { ok: true; closed: boolean; id: string } | PtyFailure;
export type ListOutcome = { ok: true; ids: string[] };

export type PtyCommands = {
	open: (args: OpenArgs, ctx?: PluginContext) => OpenOutcome;
	write: (args: { id: string; data: string }) => WriteOutcome;
	resize: (args: { id: string; cols: number; rows: number }) => ResizeOutcome;
	close: (args: { id: string }) => CloseOutcome;
	list: () => ListOutcome;
};

interface Live {
	id: string;
	term: PtyTerminal;
	closed: boolean;
}

export function createPtyPlugin(
	options: PtyOptions = {},
	os: string = process.platform,
	backend?: PtyBackend,
): PluginDefinition<"pty", PtyCommands> {
	const host = hostShell(options, os);
	// A platform with no pty answers by name rather than advertising a terminal that cannot open.
	const pty = backend ?? (os === "win32" ? undefined : posixPtyBackend());
	const terminals = new Map<string, Live>();
	let next = 0;
	// The same reap `shell` uses: quitting must not leave a shell running beside the next dev start.
	installReapOnExit();

	const prune = (): void => {
		for (const [id, record] of terminals) {
			if (terminals.size <= MAX_RECORDS) return;
			if (record.closed) terminals.delete(id);
		}
	};

	return definePlugin({
		name: "pty",
		commands: {
			open: (args: OpenArgs, ctx?: PluginContext): OpenOutcome => {
				if (pty === undefined) return windowsRefusal();
				const parsed = readOpen(args);
				if (isPtyFailure(parsed)) return parsed;
				if (parsed.program !== undefined && !sameProgram(parsed.program, host)) {
					return ptyFailure(
						"program-not-allowed",
						`pty.open: ${JSON.stringify(parsed.program)} is not the terminal this app declared; ` +
							`the host's \`pty.shell\` alone decides what runs (${host})`,
					);
				}
				const id = `pty-${++next}`;
				const sink = frameSink(ctx?.emit, id);
				let term: PtyTerminal;
				try {
					term = pty.open({
						shell: host,
						cols: parsed.cols,
						rows: parsed.rows,
						cwd: homeDir(),
						env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
						onData: (bytes) => void sink(bytes),
					});
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					return ptyFailure(
						"spawn-failed",
						`pty.open: ${JSON.stringify(host)}: ${detail}`,
					);
				}
				const emit = ctx?.emit;
				if (emit !== undefined) {
					void term.exited.then((code) => {
						emit("pty-exit", {
							id,
							exitCode: code,
							signal: signalName(term.signalCode as SignalCode),
						} satisfies PtyExit);
					});
				}
				terminals.set(id, { id, term, closed: false });
				trackChild(term);
				prune();
				return { ok: true, id, pid: term.pid };
			},
			write: (args): WriteOutcome => {
				const parsed = readWrite(args);
				if (isPtyFailure(parsed)) return parsed;
				const record = terminals.get(parsed.id);
				if (record === undefined) return unknown("write", parsed.id);
				if (record.closed || record.term.closed) return shut("write", parsed.id);
				try {
					return { ok: true, bytes: record.term.write(parsed.data) };
				} catch (error) {
					return shut("write", parsed.id, error);
				}
			},
			resize: (args): ResizeOutcome => {
				const parsed = readResize(args);
				if (isPtyFailure(parsed)) return parsed;
				const record = terminals.get(parsed.id);
				if (record === undefined) return unknown("resize", parsed.id);
				if (record.closed || record.term.closed) return shut("resize", parsed.id);
				try {
					record.term.resize(parsed.cols, parsed.rows);
				} catch (error) {
					return shut("resize", parsed.id, error);
				}
				return { ok: true, id: parsed.id, cols: parsed.cols, rows: parsed.rows };
			},
			close: (args): CloseOutcome => {
				const asked = readId(args, "close");
				if (isPtyFailure(asked)) return asked;
				const record = terminals.get(asked.id);
				if (record === undefined) return unknown("close", asked.id);
				if (record.closed || record.term.closed)
					return { ok: true, closed: false, id: asked.id };
				try {
					record.term.close();
				} catch {
					// Already closed under us; the close the page asked for still happened.
				}
				record.closed = true;
				return { ok: true, closed: true, id: asked.id };
			},
			list: (): ListOutcome => ({
				ok: true,
				ids: [...terminals.values()]
					.filter((record) => !record.closed && !record.term.closed)
					.map((record) => record.id),
			}),
		},
	});
}

/** Where a terminal starts: the user's home on either platform, else the process's own directory. */
function homeDir(): string {
	return process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
}

function unknown(command: string, id: string): PtyFailure {
	return ptyFailure(
		"unknown-terminal",
		`pty.${command}: ${JSON.stringify(id)} is not a handle this run opened`,
	);
}

function shut(command: string, id: string, error?: unknown): PtyFailure {
	const detail =
		error === undefined ? "" : `: ${error instanceof Error ? error.message : String(error)}`;
	return ptyFailure(
		"terminal-closed",
		`pty.${command}: terminal ${JSON.stringify(id)} is closed${detail}`,
	);
}
