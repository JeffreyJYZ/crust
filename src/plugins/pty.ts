/**
 * `crust:pty` — a real pseudo-terminal a page drives: open a shell, write keystrokes, read its bytes, resize, close.
 * `Bun.Terminal` is the pty on POSIX (measured on 1.4.5), so no libc is bound here; Windows has no
 * `Bun.Terminal` and no ConPTY shim yet, so `open` answers a named `not-implemented` rather than
 * registering a surface that cannot work.
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
import { hostShell, sameProgram, windowsRefusal } from "./pty-host";
import { frameSink } from "./pty-stream";
import {
	isPtyFailure,
	type PtyExit,
	type PtyFailure,
	type PtyOptions,
	ptyFailure,
} from "./pty-types";
import { signalName } from "./shell-stream";

export type { PtyData, PtyExit, PtyFailure, PtyOptions } from "./pty-types";

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
	term: Bun.Terminal;
	child: Bun.Subprocess;
	closed: boolean;
}

export function createPtyPlugin(
	options: PtyOptions = {},
	os: string = process.platform,
): PluginDefinition<"pty", PtyCommands> {
	const host = hostShell(options);
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
				if (os === "win32") return windowsRefusal();
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
				const term = new Bun.Terminal({
					cols: parsed.cols,
					rows: parsed.rows,
					name: "xterm-256color",
					data: (_term, bytes) => void sink(bytes),
				});
				let child: Bun.Subprocess;
				try {
					child = Bun.spawn({
						cmd: [host],
						cwd: process.env.HOME ?? process.cwd(),
						env: { ...process.env, TERM: "xterm-256color" },
						terminal: term,
					});
				} catch (error) {
					term.close();
					const detail = error instanceof Error ? error.message : String(error);
					return ptyFailure(
						"spawn-failed",
						`pty.open: ${JSON.stringify(host)}: ${detail}`,
					);
				}
				const emit = ctx?.emit;
				if (emit !== undefined) {
					void child.exited.then((code) => {
						emit("pty-exit", {
							id,
							exitCode: code,
							signal: signalName(child.signalCode),
						} satisfies PtyExit);
					});
				}
				terminals.set(id, { id, term, child, closed: false });
				trackChild(child);
				prune();
				return { ok: true, id, pid: child.pid };
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
				// Closing the master hangs the pty up, which ends a cooperating shell; a program that
				// traps SIGHUP is why the kill is here rather than left to the kernel.
				try {
					record.term.close();
				} catch {
					// Already closed under us; the close the page asked for still happened.
				}
				record.closed = true;
				if (record.child.exitCode === null) record.child.kill("SIGTERM");
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
