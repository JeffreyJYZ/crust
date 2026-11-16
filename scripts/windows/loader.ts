/**
 * The loader half of the Windows proof: finding `WebView2Loader.dll` and staging one where the shim
 * can load it. Kept out of `src/platform/windows/` because the platform never does this — it probes
 * for the loader and reports the remedy — and out of `windows-smoke.ts` because that file is the
 * proof, not the machine wrangling. The CI image is the case this exists for: the Evergreen runtime
 * is preinstalled and the SDK's loader is not, so the loader has to be copied out of an Edge install.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** Every Edge install that might carry the loader, bounded to a fixed list of directories. */
export function loaderRoots(env: Record<string, string | undefined> = process.env): string[] {
	const bases = [env["ProgramFiles(x86)"], env["ProgramFiles"], env["LOCALAPPDATA"]]
		.filter((base): base is string => Boolean(base))
		.filter((base) => existsSync(base));
	return bases.flatMap((base) => [
		join(base, "Microsoft", "Edge", "Application"),
		join(base, "Microsoft", "EdgeWebView", "Application"),
	]);
}

/** The first `WebView2Loader.dll` in one of those installs, version subdirectories included. */
export function findLoader(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	for (const root of loaderRoots(env)) {
		if (!existsSync(root)) continue;
		const direct = join(root, "WebView2Loader.dll");
		if (existsSync(direct)) return direct;
		for (const entry of readdirSync(root)) {
			const candidate = join(root, entry, "WebView2Loader.dll");
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Copy the loader somewhere stable and prepend that directory to `PATH`, which is what the shim's
 * `LoadLibraryW("WebView2Loader.dll")` searches. Returns the directory it staged into, so the caller
 * can print exactly what it did.
 */
export function stageLoader(found: string): string {
	const dir = join(tmpdir(), "crust-webview2");
	mkdirSync(dir, { recursive: true });
	copyFileSync(found, join(dir, "WebView2Loader.dll"));
	process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
	return dir;
}
