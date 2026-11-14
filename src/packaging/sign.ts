/**
 * Code signing, and the honest verdict that comes with it.
 *
 * What is measured on this machine (research/packaging.md §4):
 *
 *   codesign --force --sign - --timestamp=none "X.app"   -> signs, flags=0x2(adhoc)
 *   codesign --verify --verbose=4 "X.app"                -> valid on disk
 *   spctl -a -vvv "X.app"                                -> rejected, exit 3
 *
 * The spctl refusal is not a bug in this code. An ad-hoc signature cannot be
 * notarized, so Gatekeeper refuses an ad-hoc bundle on any machine that did not
 * build it. That is the whole distribution story until a Developer ID
 * certificate exists, and `signingReality()` in `reality.ts` prints it rather
 * than hiding it.
 *
 * The entitlement plist lives in `entitlements.ts`, verification in `verify.ts`,
 * and both are re-exported here so `./sign` stays the one import path.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JIT_ENTITLEMENT_PLIST } from "./entitlements";
import { runOrThrow } from "./exec";

export * from "./entitlements.ts";
export * from "./reality.ts";
export * from "./verify.ts";

export type SignMode = "adhoc" | "developer-id";

export interface SignOptions {
	/** Path to the assembled `.app`. */
	appPath: string;
	/** Defaults to `adhoc`, the only mode that works without a certificate. */
	mode?: SignMode;
	/** Developer ID identity. Required for `developer-id`; ignored for `adhoc`. */
	identity?: string;
	/** Add `--options runtime` (hardened runtime). */
	hardenedRuntime?: boolean;
	/**
	 * Seal the JIT entitlement. Defaults to true when `hardenedRuntime` is set.
	 * Pass `false` to reproduce the measured no-entitlement probe.
	 */
	jitEntitlement?: boolean;
}

export interface SignResult {
	appPath: string;
	mode: SignMode;
	identity: string;
	hardenedRuntime: boolean;
	entitled: boolean;
}

/**
 * Sign `appPath`.
 *
 * `--force` replaces an existing signature, which is what makes a rebuild
 * idempotent. `--timestamp=none` is used for ad-hoc: an ad-hoc signature has no
 * chain to timestamp against, and asking for one only slows the build.
 */
export async function signApp(options: SignOptions): Promise<SignResult> {
	const mode = options.mode ?? "adhoc";
	const identity = mode === "adhoc" ? "-" : (options.identity?.trim() ?? "");
	if (mode === "developer-id" && identity.length === 0) {
		throw new Error(
			"Developer ID signing needs an identity. Set CRUST_SIGNING_IDENTITY to a " +
				'"Developer ID Application: …" certificate, or sign ad-hoc for local use only. ' +
				"An ad-hoc signature can never be notarized.",
		);
	}

	const hardenedRuntime = options.hardenedRuntime ?? false;
	const entitled = hardenedRuntime && (options.jitEntitlement ?? true);

	const args = ["codesign", "--force", "--sign", identity];
	if (mode === "adhoc") {
		args.push("--timestamp=none");
	}
	if (hardenedRuntime) {
		args.push("--options", "runtime");
	}

	let entitlementsDir: string | undefined;
	let entitlementsPath: string | undefined;
	if (entitled) {
		entitlementsDir = join(tmpdir(), `crust-entitlements-${process.pid}-${Date.now()}`);
		await mkdir(entitlementsDir, { recursive: true });
		entitlementsPath = join(entitlementsDir, "jit.entitlements");
		await writeFile(entitlementsPath, JIT_ENTITLEMENT_PLIST, "utf8");
		args.push("--entitlements", entitlementsPath);
	}

	args.push(options.appPath);

	try {
		// One invocation per artefact. codesign rewrites the Mach-O in place to
		// embed the signature, so the binary on disk changes size (89,159,906 ->
		// 88,642,144 in the probe); nothing may hold the file open across it.
		await runOrThrow(args);
	} finally {
		if (entitlementsDir) {
			await rm(entitlementsDir, { recursive: true, force: true });
		}
	}

	return { appPath: options.appPath, mode, identity, hardenedRuntime, entitled };
}
