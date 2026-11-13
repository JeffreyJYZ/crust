/**
 * Which paths under the project directory never restart the backend.
 *
 * `crust dev` watches `dirname(entry)` recursively, so a framework writing its own
 * output into the project would restart the process on every write — and a restart
 * rotates the bridge token, so the page already loaded then fails with a missing
 * bearer token. Measured: `next dev` did this twice in one page load before `.next`
 * and `out` were excluded.
 */
const IGNORED = /(^|[/\\])(public|dist|node_modules|\.next|out|\.crust)([/\\]|$)/;

/** True when a watched change belongs to the frontend or to build output, not the backend. */
export function isIgnoredWatchPath(filename: string | null | undefined): boolean {
	return IGNORED.test(String(filename ?? ""));
}
