/**
 * Which paths under the project directory never restart the backend. `crust dev` watches `dirname(entry)` recursively, so a framework writing output into the project would restart on every write — and a restart rotates the bridge token, so the loaded page then fails with a missing bearer token. Measured: `next dev` did this twice in one page load before `.next` and `out` were excluded.
 */
const IGNORED = /(^|[/\\])(public|dist|node_modules|\.next|out|\.crust)([/\\]|$)/;

/** True when a watched change belongs to the frontend or to build output, not the backend. */
export function isIgnoredWatchPath(filename: string | null | undefined): boolean {
	return IGNORED.test(String(filename ?? ""));
}

/**
 * True for a file the frontend owns, judged by extension. The backend entry is routinely `main.ts` at the project root, so `crust dev` watches the whole project and every UI save would restart the runtime, rotate the token and break the page in front of the user; a `dev.url` project has its own reload path, so these extensions are left to it.
 * `.ts`/`.js` are deliberately absent — the backend entry is one, and a plugin or command file is backend code.
 */
const FRONTEND_SOURCE = /\.(?:tsx|jsx|css|scss|sass|less|html|svg|png|jpe?g|gif|webp|woff2?)$/i;

/** True when the change is frontend source that a dev server should own. */
export function isFrontendSource(filename: string | null | undefined): boolean {
	return FRONTEND_SOURCE.test(String(filename ?? ""));
}
