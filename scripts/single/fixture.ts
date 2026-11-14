/**
 * The single-file proof's fixture: the one file a user names, the lines its
 * runtime prints, and the two page bodies a rebuild is judged against.
 */
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

/** The checkout this proof drives, and the CLI every phase runs. */
export const REPO_ROOT = resolve(import.meta.dir, "../..");
export const CLI = join(REPO_ROOT, "src/cli/index.ts");

/** The file the user names; its basename is also the app name and bundle name. */
export const APP_FILE = "app.tsx";
export const BUNDLE_NAME = "app.app";

/**
 * `registerSingleCommands` logs this once the page's `invoke("info")` has been
 * answered. Matching the whole sentence, not the word "info", keeps the
 * assertion about the round trip rather than about output existing.
 */
export const INFO = /info\s+app answered the page/;
/** The dev runtime printing the address it serves the page from. */
export const BRIDGE = /bridge\s+http:\/\//;
/** A page edit rebuilt and the window was told to reload. */
export const REBUILT = /page\s+rebuilt/;
/** A rebuild failed; the previous page is untouched. */
export const BUILD_FAILED = /page\s+build failed/;
/** The runtime was restarted instead of reloaded — the thing phase 3 forbids. */
export const RESTARTED = /restart\s+backend changed/;

/** Watcher startup, the shim compile and WebKit's web process. Measured ~2 s. */
export const DEV_TIMEOUT_MS = 30_000;
/** One save, its rebuild and the page's poll interval (400 ms) — measured < 1 s. */
export const STEP_TIMEOUT_MS = 15_000;
/** A window plus WebKit's web process, measured ~1 s. */
export const APP_TIMEOUT_MS = 15_000;

/** Every path a phase needs, derived from the one scratch directory. */
export interface Paths {
	appFile: string;
	bundle: string;
	binary: string;
	devDir: string;
	devPage: string;
	reloadMarker: string;
}

export function pathsOf(scratch: string): Paths {
	const devDir = join(scratch, ".crust", "single");
	const bundle = join(scratch, "dist", BUNDLE_NAME);
	return {
		appFile: join(scratch, APP_FILE),
		bundle,
		binary: join(bundle, "Contents", "MacOS", "crust-app"),
		devDir,
		devPage: join(devDir, "page.js"),
		reloadMarker: join(devDir, "__crust_reload.txt"),
	};
}

/**
 * The page under test. No `export default`, so crust loads it for its side effects and no React is needed. `marker` reaches the bundled `page.js`, so an edit shows in the served bytes and not only in the source.
 */
export function pageSource(marker: string): string {
	return [
		"// Written by scripts/e2e-single.ts, not by crust. No default export:",
		"// this module owns the document and proves the bridge by calling it.",
		`document.body.textContent = "single-file ${marker}";`,
		'window.crust.invoke("info");',
		"",
	].join("\n");
}

/** A file a user could plausibly leave half-typed: Bun.build throws on it. */
export function brokenSource(): string {
	return ["// half-typed on purpose", "document.body.textContent = ;", ""].join("\n");
}

/** The bytes of a file, as a digest — the cheapest "did this change" proof. */
export async function digest(path: string): Promise<string> {
	const bytes = await Bun.file(path)
		.arrayBuffer()
		.catch(() => undefined);
	if (bytes === undefined) return "missing";
	return createHash("sha256").update(new Uint8Array(bytes)).digest("hex").slice(0, 12);
}
