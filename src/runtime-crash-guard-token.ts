/**
 * The guard's identity token. A pid is only a number the OS may reuse, so the parent leaves a random
 * id in a 0600 file and passes the same id to the guard. A clean exit removes it in the parent's
 * `exit` handler; a crash handler's `_exit` cannot, so a held token is what proves the pid still
 * belongs to the process the guard armed.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The environment half of the token, for a compiled app whose argv belongs to the app. */
export const GUARD_TOKEN_VAR = "CRUST_CRASH_GUARD_TOKEN";

const TOKEN_FILE = "crash-guard.token";

export function guardTokenPath(root: string): string {
	return join(root, TOKEN_FILE);
}

/** Create a fresh token file and answer its value. */
export function armGuardToken(root: string): string {
	const token = randomBytes(16).toString("hex");
	writeFileSync(guardTokenPath(root), token, { mode: 0o600 });
	return token;
}

/** Remove the token only when it is still the one this process armed. */
export function disarmGuardToken(root: string, token: string): void {
	try {
		if (readFileSync(guardTokenPath(root), "utf8") === token) {
			rmSync(guardTokenPath(root), { force: true });
		}
	} catch {
		// Already gone: a clean exit after a guard stopped, or a root that never held one.
	}
}

/** True while the guard's own token is still in place. A hand-run guard has no token: pid only. */
export function guardTokenHeld(root: string, token: string | undefined): boolean {
	if (token === undefined) return true;
	try {
		return readFileSync(guardTokenPath(root), "utf8") === token;
	} catch {
		return false;
	}
}
