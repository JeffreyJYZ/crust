/**
 * The dev handshake's one location, deliberately outside the project root a dev
 * server serves. A credential file inside the root is readable by any page through
 * `fetch`, so per-label tokens stored there turn a `main` page into an `admin` one.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** File-name patterns the Vite plugin refuses through `server.fs.deny`. */
export const DEV_HANDSHAKE_DENY = [
	".crust/**",
	"**/.crust/**",
	"crust-dev-*.json",
	"**/crust-dev-*.json",
];

/**
 * The handshake for a project, in the OS temp dir. Stable across processes, so a
 * dev server started before the runtime still finds the file once it exists, and
 * unique per project so two projects in one checkout cannot share a token set.
 */
export function devHandshakePath(projectDir: string): string {
	const target = resolve(projectDir);
	let hash = 2166136261;
	for (let index = 0; index < target.length; index++) {
		hash ^= target.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return join(tmpdir(), `crust-dev-${(hash >>> 0).toString(36)}.json`);
}
