/**
 * The native half `crust:pty` picks per platform: one interface, two implementations.
 *
 * POSIX is `Bun.Terminal` (`pty-posix.ts`). Windows is a ConPTY shim
 * (`platform/windows/pty-conpty.ts`), because `Bun.Terminal` does not exist there. The plugin owns
 * the handles, the argument readers and the events; a backend owns only the pty and its child, so
 * neither platform's spawn rules leak into the other.
 *
 * A handle is deliberately shaped like the part of `Bun.Subprocess` `child-reap` tracks (`pid`,
 * `exitCode`, `signalCode`, `exited`, `kill`), so the same reap ends a ConPTY shell and a
 * `Bun.Terminal` one with no branch in the reap.
 */

/** What `open` needs from the caller: a program, a size, and where its bytes go. */
export interface PtyOpenRequest {
	/** The host's `pty.shell`, resolved to a real path by `pty-host.ts`. */
	shell: string;
	/** Extra command line for a probe that needs a non-interactive client; the plugin passes none. */
	args?: string;
	cols: number;
	rows: number;
	cwd: string;
	env: Record<string, string>;
	/** One read's bytes, in order. The sink base64s each frame, so this is never decoded. */
	onData: (bytes: Uint8Array) => void;
}

/** One live terminal, as the plugin and `child-reap` see it. */
export interface PtyTerminal {
	readonly pid: number;
	readonly closed: boolean;
	readonly exitCode: number | null;
	readonly signalCode: string | number | null;
	/** The child's own status; never the pty's lifecycle code. */
	readonly exited: Promise<number>;
	/** How many bytes the pty accepted; a throw means the terminal is gone. */
	write(data: string): number;
	resize(cols: number, rows: number): void;
	/** Hang up the child and release the pty. Idempotent. */
	close(): void;
	/** Signal the child only, leaving the handle's own close to the caller. */
	kill(signal?: string | number): void;
}

/** A platform's pty. `open` throws on failure; the plugin turns that into `spawn-failed`. */
export interface PtyBackend {
	open(request: PtyOpenRequest): PtyTerminal;
}
