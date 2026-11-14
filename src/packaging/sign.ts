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
 * certificate exists, and `reality()` below prints it rather than hiding it.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runOrThrow, run } from "./exec";

/**
 * The hardened-runtime entitlements crust needs, both measured on 2026-11-14.
 *
 * `allow-jit` is the one Apple documents for JIT and it is required, but it is
 * **not sufficient**: it permits `MAP_JIT` pages, and the TinyCC inside Bun
 * instead writes machine code into ordinary unsigned executable memory. Sealed
 * with `allow-jit` alone, a signed app starts, creates no page and prints
 * nothing — `crust sign` produced exactly that on a notify probe, exit stayed 0
 * and only the silence showed it. `allow-unsigned-executable-memory` is what
 * makes the same bundle run.
 *
 * This also corrects an earlier note: that probe tested `new Function` inside
 * the *Bun* process, which is not the blocked path, so "no entitlement needed"
 * was never a safe reading of it.
 */
export const JIT_ENTITLEMENT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
</dict>
</plist>
`;

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

export interface VerifyResult {
	valid: boolean;
	exitCode: number;
	output: string;
}

export interface GatekeeperResult {
	accepted: boolean;
	exitCode: number;
	raw: string;
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

/** `codesign --verify` — cheap, local, no Gatekeeper, no network. */
export async function verifySignature(appPath: string): Promise<VerifyResult> {
	const result = await run(["codesign", "--verify", "--verbose=4", appPath]);
	return {
		valid: result.code === 0,
		exitCode: result.code,
		output: (result.stderr || result.stdout).trim(),
	};
}

/**
 * `codesign -dv` — read the signature without validating every sealed file.
 *
 * This is the cheap half of verification and the one to use in a loop or in CI
 * where a full `--verify` plus `spctl` pair costs real time per artefact.
 */
export async function describeSignature(appPath: string): Promise<string> {
	const result = await run(["codesign", "-dv", "--verbose=4", appPath]);
	return (result.stderr || result.stdout).trim();
}

/**
 * Ask Gatekeeper. Expensive, and the answer is already known for ad-hoc.
 *
 * Included because `crust sign` must be able to tell the user the truth about
 * their own signature, and because a Developer ID build answers differently.
 * Call it once per artefact, never per check.
 */
export async function assessGatekeeper(appPath: string): Promise<GatekeeperResult> {
	const result = await run(["spctl", "-a", "-vvv", appPath]);
	return {
		accepted: result.code === 0,
		exitCode: result.code,
		raw: (result.stderr || result.stdout).trim(),
	};
}

/**
 * The lines a build must print, whether or not the user asks.
 *
 * Ad-hoc is rejected by Gatekeeper on every other machine, so an app can only
 * be distributed once a Developer ID exists. Printing that on success is the
 * difference between an honest tool and one that implies a signed app is
 * shippable.
 */
export function signingReality(result: SignResult): string[] {
	const lines = [
		`signed ${result.appPath} — ${result.mode}${result.hardenedRuntime ? " + hardened runtime" : ""}`,
	];

	if (result.mode === "adhoc") {
		lines.push(
			"spctl rejects this bundle (exit 3): an ad-hoc signature cannot be notarized, " +
				"so it runs local builds only. Distributing it means the recipient clears " +
				"quarantine (xattr -dr com.apple.quarantine) or right-clicks Open, once.",
		);
		lines.push(
			"Distribution requires a Developer ID Application certificate: Developer ID " +
				"codesign, notarytool submit --wait, then stapler staple.",
		);
	}

	if (result.entitled) {
		lines.push(
			"com.apple.security.cs.allow-jit is sealed. Its necessity is unproven for Bun's " +
				"runtime — codegen ran under --options runtime with no entitlement at all. " +
				"WKWebView's WebContent process is the unmeasured case.",
		);
	}

	return lines;
}
