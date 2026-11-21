/**
 * The types behind `crust:sidecar`, kept apart from the plugin so the locator, the fake and the
 * control registry can import them without pulling in `definePlugin` or the runtime plugin body.
 */

import type { PluginContext } from "./define";

/** The structural shape of a child process the plugin needs; `Bun.spawn` satisfies it. */
export interface SidecarChild {
	readonly pid: number;
	/** A writable pipe when `spawn` opened stdin; null when the platform gave us none. */
	readonly stdin: WritableStream<Uint8Array> | null;
	readonly stdout: ReadableStream<Uint8Array> | null;
	readonly stderr: ReadableStream<Uint8Array> | null;
	readonly exited: Promise<number>;
	readonly exitCode: number | null;
	readonly signalCode: number | string | null;
	kill(signal?: number | string): void;
}

export type SidecarSpawner = (
	cmd: readonly string[],
	options: { cwd?: string; env: Record<string, string> },
) => SidecarChild;

export type SidecarFailureCode =
	| "invalid-args"
	| "sidecar-not-declared"
	| "sidecar-path-escape"
	| "sidecar-missing"
	| "sidecar-unknown-id"
	| "sidecar-write-failed"
	| "sidecar-kill-failed";

export interface SidecarFailure {
	ok: false;
	code: SidecarFailureCode;
	message: string;
}

export interface SidecarSpawnArgs {
	name: string;
	args?: string[];
}

export interface SidecarSpawned {
	ok: true;
	id: string;
	name: string;
	pid: number;
}

/** `data` is the brief's shape; `text` is accepted as an alias for Butter's `{ id, text }` call. */
export interface SidecarWriteArgs {
	id: string;
	data?: string | Uint8Array;
	text?: string;
}

export interface SidecarWritten {
	ok: true;
	id: string;
	bytes: number;
}

/** One live child, as returned by `sidecar.list`. */
export interface SidecarListEntry {
	id: string;
	name: string;
	pid: number;
	/** Epoch milliseconds at which `spawn` started the child. */
	startedAt: number;
}

export interface SidecarListed {
	ok: true;
	children: SidecarListEntry[];
	/** Declared binary names — Butter's `sidecar:list` answer, kept for parity. */
	names: string[];
}

export interface SidecarKillArgs {
	id: string;
	/** Optional first signal; defaults to SIGTERM. SIGKILL still follows after the grace. */
	signal?: number | string;
}

export interface SidecarKilled {
	ok: true;
	id: string;
	/** False when the child had already exited: a departed child was not killed by this call. */
	killed: boolean;
}

export interface SidecarStdout {
	id: string;
	name: string;
	text: string;
}

export interface SidecarExit {
	id: string;
	name: string;
	code: number | null;
	signal: number | string | null;
}

export type SidecarCommands = {
	spawn: (args: SidecarSpawnArgs, ctx: PluginContext) => Promise<SidecarSpawned | SidecarFailure>;
	write: (args: SidecarWriteArgs, ctx: PluginContext) => Promise<SidecarWritten | SidecarFailure>;
	list: (args: unknown, ctx: PluginContext) => Promise<SidecarListed>;
	kill: (args: SidecarKillArgs, ctx: PluginContext) => Promise<SidecarKilled | SidecarFailure>;
};

export interface SidecarOptions {
	/** Names declared in `build.sidecars`; anything else is refused. */
	names?: readonly string[];
	/** Directory the binaries were copied into. */
	dir?: string;
	/** Injectable for tests; defaults to `Bun.spawn`. */
	spawn?: SidecarSpawner;
	/** Grace before SIGKILL when a child ignores the first signal. Defaults to 2000 ms. */
	killGraceMs?: number;
}
