/**
 * Which program a `crust:pty` terminal may run, and why only that one.
 * A terminal's purpose is an unconstrained login shell, so a page-reachable `pty.open` that took a
 * program name would hand any script in the webview local command execution. The host's `pty.shell`
 * is therefore the whole allowlist: the page may name a program, and the only accepted answer is
 * that same program compared as a real path.
 */

import { realpathSync } from "node:fs";

import { notImplemented } from "./define";
import type { PtyOptions } from "./pty-types";

/** A path's real form, or its resolved form when it does not exist — the comparison shell makes too. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		try {
			return Bun.resolveSync(path, process.cwd());
		} catch {
			return path;
		}
	}
}

/** The shell a platform logs a user in with when the host named none. */
export function defaultShell(os: string = process.platform): string {
	if (os === "win32") return process.env.ComSpec ?? "cmd.exe";
	return process.env.SHELL ?? "/bin/sh";
}

/** The one program the host's section names; the login shell only when the host named none. */
export function hostShell(options: PtyOptions, os: string = process.platform): string {
	const named = options.shell ?? defaultShell(os);
	const found = named.includes("/") || named.includes("\\") ? real(named) : Bun.which(named);
	return found ?? named;
}

/** Whether a page's `program` is the host's own, compared as real paths so `/bin/sh` and `/bin/dash` differ. */
export function sameProgram(asked: string, host: string): boolean {
	const path = asked.includes("/") || asked.includes("\\");
	const resolved = path ? real(asked) : (Bun.which(asked) ?? asked);
	return resolved === host || real(resolved) === real(host);
}

/**
 * What `pty.open` answers on a Windows run with no platform attached, so no ConPTY shim exists.
 * Named rather than silent: the page learns what is missing, so an app can fall back on `shell`
 * instead of retrying a command that will never work there.
 */
export function windowsRefusal(): ReturnType<typeof notImplemented> {
	return notImplemented(
		"pty.open needs a pseudo-console: no Windows platform is attached, so the ConPTY shim " +
			"that backs Bun-less Windows has not compiled in this process",
		"CreatePseudoConsole",
	);
}
