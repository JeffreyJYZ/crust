/**
 * Assert what the UI cannot.
 *
 * A Finder window shows an icon and a name. It does not show whether
 * `CFBundleExecutable` names a file that actually exists inside
 * `Contents/MacOS/`, whether the ATS keys are the ones a `WKWebView` needs,
 * or whether the signature is ad-hoc. This script reads those bytes and prints
 * one verdict line. Non-zero exit on any gap, so CI fails on it.
 *
 * Usage:
 *   bun scripts/verify-release.ts <path to X.app>
 *   bun scripts/verify-release.ts            # first *.app in dist/, then scripts/out/
 *
 * Deliberately cheap: `plutil` to parse, `codesign -dv` to read the signature.
 * No `codesign --verify` pass over every sealed file and no `spctl` assessment —
 * the spctl verdict is a known, measured refusal for ad-hoc (exit 3), and
 * reproducing it per run only burns time. Use `crust sign` when that answer
 * needs to be current.
 *
 * The plist and executable checks are `verify-release/plist.ts`; only the
 * signature, the quarantine attribute and the verdict line are here.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { allocatedKiB, run } from "../src/packaging/exec.ts";
import { formatBytes } from "../src/packaging/build.ts";
import { type Check, findBundle, readBundle } from "./verify-release/plist.ts";

interface Gap {
	what: string;
	detail: string;
}

async function main(): Promise<number> {
	const appPath = await findBundle(process.argv[2]);
	const appStat = await stat(appPath).catch(() => undefined);
	if (!appStat?.isDirectory()) {
		console.log(`verify-release: FAIL  1 gap(s)  ${appPath}`);
		console.log(`  bundle      ${appPath} is not a directory`);
		return 1;
	}

	const gaps: Gap[] = [];
	const check: Check = (what, ok, detail) => {
		if (!ok) {
			gaps.push({ what, detail });
		}
	};

	const { plist, executableDir, executable } = await readBundle(check, appPath);

	// ---- signature --------------------------------------------------------
	// `codesign -dv` is the cheap read: it prints the signature's own facts but
	// does not re-verify every sealed file. That is enough to catch unsigned,
	// ad-hoc, and a signature whose Identity disagrees with the bundle.
	const signature = await run(["codesign", "-dv", "--verbose=4", appPath]);
	const signatureText = (signature.stderr || signature.stdout).trim();
	check(
		"bundle is signed",
		signature.code === 0 && signatureText.length > 0,
		signatureText || "codesign -dv produced nothing",
	);

	const identifier = signatureText.match(/^Identifier=(.+)$/m)?.[1]?.trim();
	if (typeof plist.CFBundleIdentifier === "string" && identifier) {
		check(
			"signature Identifier matches CFBundleIdentifier",
			identifier === plist.CFBundleIdentifier,
			`signature ${identifier} vs plist ${plist.CFBundleIdentifier}`,
		);
	}

	const isAdhoc = /Signature=adhoc/m.test(signatureText);
	const isDeveloperId = /Authority=Developer ID Application/m.test(signatureText);
	if (isAdhoc) {
		// Recorded, not asserted: it is a correct local build. The distribution
		// consequence belongs to `crust sign`, which prints it on every ad-hoc sign.
		process.stderr.write("note: ad-hoc signature — spctl will reject it, local use only\n");
	} else {
		check(
			"signature is ad-hoc or Developer ID",
			isDeveloperId,
			signatureText.split("\n")[0] ?? "unknown signature kind",
		);
	}

	// ---- quarantine -------------------------------------------------------
	// A locally built bundle has none. If it does, a direct execution is killed
	// by the kernel with SIGKILL 137 and no message, which reads as a crash.
	const xattrs = await run(["xattr", "-l", appPath]);
	check(
		"no com.apple.quarantine",
		!/com\.apple\.quarantine/m.test(xattrs.stdout),
		xattrs.stdout.trim() || "xattr -l printed nothing",
	);

	// ---- sizes, for the verdict line -------------------------------------
	const binaryBytes =
		typeof executable === "string"
			? ((await stat(join(executableDir, executable)).catch(() => undefined))?.size ?? 0)
			: 0;
	const assembledBytes = (await allocatedKiB(appPath)) * 1024;
	const signatureKind = isAdhoc ? "adhoc" : isDeveloperId ? "developer-id" : "other";

	if (gaps.length > 0) {
		for (const gap of gaps) {
			console.log(`  ${gap.what}: ${gap.detail}`);
		}
		console.log(`verify-release: FAIL  ${gaps.length} gap(s)  ${appPath}`);
		return 1;
	}

	console.log(
		`verify-release: PASS  ${appPath}  ` +
			`binary ${formatBytes(binaryBytes)} · bundle ${formatBytes(assembledBytes)} · ${signatureKind}`,
	);
	return 0;
}

try {
	process.exit(await main());
} catch (error) {
	// A missing argument or an unreadable bundle is still a verdict, not a stack trace.
	console.log(`verify-release: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
