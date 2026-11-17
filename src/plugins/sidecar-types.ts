/**
 * The types behind `crust:sidecar`, kept apart from the plugin so the locator and the fake can
 * import them without pulling in `definePlugin` or the runtime plugin body.
 */

import type { PluginContext } from "./define";

/** The structural shape of a child process the plugin needs; `Bun.spawn` satisfies it. */
export interface SidecarChild {
	readonly pid: number;
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
	"invalid-args" | "sidecar-not-declared" | "sidecar-path-escape" | "sidecar-missing";

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
};

export interface SidecarOptions {
	/** Names declared in `build.sidecars`; anything else is refused. */
	names?: readonly string[];
	/** Directory the binaries were copied into. */
	dir?: string;
	/** Injectable for tests; defaults to `Bun.spawn`. */
	spawn?: SidecarSpawner;
}
