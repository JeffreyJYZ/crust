/**
 * Code signing, and the honest verdict that comes with it. Measured on this machine (`research/packaging.md` §4): `codesign --force --sign - --timestamp=none` gives `flags=0x2(adhoc)`, `codesign --verify` says valid on disk, and `spctl -a -vvv` rejects with exit 3.
 * The spctl refusal is not a bug: an ad-hoc signature cannot be notarized, so Gatekeeper refuses the bundle on any machine that did not build it, and `signingReality()` prints that rather than hiding it. Entitlements in `entitlements.ts`, verification in `verify.ts`.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hardenedEntitlements } from "./entitlements";
import { runOrThrow } from "./exec";

export * from "./entitlements.ts";
export * from "./reality.ts";
export * from "./verify.ts";

export type SignMode = "adhoc" | "developer-id";

/** The runner, injectable so a test records the exact codesign argv and its order. */
export type SignExec = (args: string[]) => Promise<unknown>;

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
	/**
	 * Seal `com.apple.security.device.audio-input` for `security.microphone`. Only meaningful
	 * with `hardenedRuntime`, which is the only mode that enforces entitlements at all.
	 */
	microphone?: boolean;
	/**
	 * Already-resolved sidecar paths to sign before the bundle, deepest first. Each gets the
	 * same identity, timestamp, runtime options and entitlements as the app. Ad-hoc callers
	 * leave this unset and keep their byte-identical argv.
	 */
	sidecars?: readonly string[];
	/** Defaults to `runOrThrow`; a test passes a recorder. */
	exec?: SignExec;
}

export interface SignResult {
	appPath: string;
	mode: SignMode;
	identity: string;
	hardenedRuntime: boolean;
	entitled: boolean;
}

/**
 * The exact codesign argv for one artefact. Kept pure so the ordering and flags can be read
 * by a test without a certificate. Ad-hoc stays byte-identical: `--timestamp=none` and nothing
 * else. Developer ID gets `--timestamp` — Apple names a missing secure timestamp as a
 * notarization rejection — and shares the identity, runtime options and entitlements.
 */
export function signCommand(
	path: string,
	options: {
		identity: string;
		mode: SignMode;
		hardenedRuntime?: boolean;
		entitlementsPath?: string;
	},
): string[] {
	const args = ["codesign", "--force", "--sign", options.identity];
	if (options.mode === "adhoc") {
		args.push("--timestamp=none");
	} else {
		args.push("--timestamp");
	}
	if (options.hardenedRuntime) {
		args.push("--options", "runtime");
	}
	if (options.entitlementsPath) {
		args.push("--entitlements", options.entitlementsPath);
	}
	args.push(path);
	return args;
}

/**
 * Sign `sidecars` first, deepest first, then seal `appPath`. `--force` replaces the ad-hoc
 * signatures the plain build already applied: codesign does not re-sign nested code that is
 * already signed, so leaving a sidecar ad-hoc makes notarization reject the whole bundle.
 * One invocation per artefact — codesign rewrites the Mach-O in place, so nothing may hold a
 * file open across its signature.
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
	const exec = options.exec ?? runOrThrow;

	let entitlementsDir: string | undefined;
	let entitlementsPath: string | undefined;
	if (entitled) {
		entitlementsDir = join(tmpdir(), `crust-entitlements-${process.pid}-${Date.now()}`);
		await mkdir(entitlementsDir, { recursive: true });
		entitlementsPath = join(entitlementsDir, "crust.entitlements");
		await writeFile(
			entitlementsPath,
			hardenedEntitlements({ microphone: options.microphone === true }),
			"utf8",
		);
	}

	const commandOptions = { identity, mode, hardenedRuntime, entitlementsPath };
	const targets = [...(options.sidecars ?? []), options.appPath];

	try {
		for (const target of targets) {
			await exec(signCommand(target, commandOptions));
		}
	} finally {
		if (entitlementsDir) {
			await rm(entitlementsDir, { recursive: true, force: true });
		}
	}

	return { appPath: options.appPath, mode, identity, hardenedRuntime, entitled };
}
