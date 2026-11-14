/**
 * Finding the bundle, and reading the plist facts a Finder window does not show:
 * the required strings, `CFBundleExecutable` landing on a real file, PkgInfo, and
 * the ATS keys a `WKWebView` needs.
 */
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ATS_KEYS, PKG_INFO, REQUIRED_PLIST_STRINGS } from "../../src/packaging/app.ts";
import { run } from "../../src/packaging/exec.ts";

/** Record one gap; the caller decides what a gap means for the exit code. */
export type Check = (what: string, ok: boolean, detail: string) => void;

export interface Read {
	plist: Record<string, unknown>;
	executableDir: string;
	executable: unknown;
}

export async function findBundle(argument: string | undefined): Promise<string> {
	if (argument) {
		return resolve(argument);
	}
	for (const dir of ["dist", "scripts/out"]) {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		const bundle = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
		if (bundle) {
			return resolve(join(dir, bundle.name));
		}
	}
	throw new Error("no .app given and none found in dist/ or scripts/out/");
}

export async function readBundle(check: Check, appPath: string): Promise<Read> {
	const contents = join(appPath, "Contents");
	const infoPlistPath = join(contents, "Info.plist");
	const executableDir = join(contents, "MacOS");

	// ---- Info.plist -------------------------------------------------------
	const lint = await run(["plutil", "-lint", infoPlistPath]);
	check(
		"Info.plist lint",
		lint.code === 0,
		(lint.stdout || lint.stderr).trim() || "plutil -lint failed",
	);

	let plist: Record<string, unknown> = {};
	const asJson = await run(["plutil", "-convert", "json", "-o", "-", infoPlistPath]);
	if (asJson.code === 0) {
		try {
			plist = JSON.parse(asJson.stdout) as Record<string, unknown>;
		} catch (error) {
			check("Info.plist parse", false, `plutil emitted unparseable JSON: ${String(error)}`);
		}
	} else {
		check(
			"Info.plist parse",
			false,
			(asJson.stderr || asJson.stdout).trim() || "plutil -convert failed",
		);
	}

	for (const key of REQUIRED_PLIST_STRINGS) {
		const value = plist[key];
		check(
			`${key} present`,
			typeof value === "string" && value.length > 0,
			`got ${JSON.stringify(value)}`,
		);
	}

	// The package type is the one string with a fixed correct value.
	check(
		"CFBundlePackageType is APPL",
		plist.CFBundlePackageType === "APPL",
		`got ${JSON.stringify(plist.CFBundlePackageType)}`,
	);

	// ---- executable -------------------------------------------------------
	const executable = plist.CFBundleExecutable;
	const executablePresent = typeof executable === "string" && executable.length > 0;
	if (executablePresent) {
		const executablePath = join(executableDir, executable);
		const executableStat = await stat(executablePath).catch(() => undefined);
		check(
			"Contents/MacOS/<CFBundleExecutable> exists",
			executableStat?.isFile() === true,
			`${executablePath} missing`,
		);
		check(
			"compiled binary is executable",
			(executableStat?.mode ?? 0) & 0o111 ? true : false,
			`${executablePath} is not +x`,
		);
	}

	// ---- PkgInfo ----------------------------------------------------------
	const pkgInfo = await Bun.file(join(contents, "PkgInfo"))
		.text()
		.catch(() => "");
	check("PkgInfo is APPL????", pkgInfo === PKG_INFO, `got ${JSON.stringify(pkgInfo)}`);

	// ---- App Transport Security -------------------------------------------
	// Both keys, both true. NSAllowsArbitraryLoadsInWebContent is the one that
	// governs a WKWebView's own content; NSAllowsLocalNetworking covers the
	// localhost case and does not replace it for a bare IP on macOS 14+.
	const ats = plist.NSAppTransportSecurity;
	const atsDict =
		typeof ats === "object" && ats !== null && !Array.isArray(ats)
			? (ats as Record<string, unknown>)
			: {};
	check(
		"NSAppTransportSecurity is a dict",
		Object.keys(atsDict).length > 0,
		`got ${JSON.stringify(ats)}`,
	);
	for (const key of ATS_KEYS) {
		check(`ATS ${key} is true`, atsDict[key] === true, `got ${JSON.stringify(atsDict[key])}`);
	}

	check(
		"NSHighResolutionCapable is true",
		plist.NSHighResolutionCapable === true,
		`got ${JSON.stringify(plist.NSHighResolutionCapable)}`,
	);

	return { plist, executableDir, executable };
}
