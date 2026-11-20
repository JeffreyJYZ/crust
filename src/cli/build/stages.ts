/**
 * The release stages folded into one `crust build`, with one exit code.
 *
 * The order is a delivery contract, not a style choice: codesign the `.app`
 * with Developer ID, submit it and staple the ticket, then build the disk
 * image from the already-stapled app. A dmg of an unsigned app, or a notarize
 * of an ad-hoc bundle, is an artefact Apple refuses. We deliberately do NOT
 * notarize the dmg itself: this repo's notary plan zips and staples a `.app`
 * (`packaging/notarize-plan.ts`), so the app's ticket travels inside the image,
 * and notarizing the image would need a separate plan and its own staple target.
 * Signing replaces the ad-hoc signature `crust build` already applied.
 */

import { dirname } from "node:path";
import type { CrustConfig } from "@/config";
import { preflightNotarize, type Exec, CREDENTIAL_REQUIRES } from "@/packaging/notarize";
import { dmgStage } from "../dmg.ts";
import { notarizeEnv, notarizeStage } from "../notarize.ts";
import { dmgOptions } from "../package/options.ts";
import { signStage } from "../sign.ts";
import type { CliOptions } from "../util.ts";

/** Test seams: platform, environment and the notary tool runner. */
export interface StageSeams {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	exec?: Exec;
	/** Stage runners, injected by a test so the order is proved without Apple tools. */
	sign?: typeof signStage;
	notarize?: typeof notarizeStage;
	dmg?: typeof dmgStage;
}

/** Named refusals, decided before any build work runs. */
export function stageRefusal(options: CliOptions, seams: StageSeams = {}): string | undefined {
	const platform = seams.platform ?? process.platform;
	const env = seams.env ?? process.env;
	if (options.notarize && !options.sign) {
		return (
			"notarize requires --sign — an ad-hoc signature cannot be submitted; add " +
			"--sign with CRUST_SIGNING_IDENTITY"
		);
	}
	if (options.dmg && platform !== "darwin") {
		return `--dmg has no disk image on ${platform} — a disk image is macOS only`;
	}
	if (options.sign && platform !== "darwin") {
		return `--sign needs codesign, which is macOS-only (this platform is ${platform})`;
	}
	const identity = env.CRUST_SIGNING_IDENTITY?.trim() ?? "";
	if (options.sign && identity.length === 0) {
		return (
			'sign requires CRUST_SIGNING_IDENTITY — set "Developer ID Application: ' +
			'Name (TEAMID)"'
		);
	}
	if (options.notarize) {
		const preflight = preflightNotarize({ appPath: "", ...notarizeEnv(env) });
		if (!preflight.ok) {
			return `notarize requires ${preflight.requires === CREDENTIAL_REQUIRES ? "notarytool credentials" : "a Developer ID signature"} — ${preflight.requires}`;
		}
	}
	return undefined;
}

/** Whether the invocation asked for any stage after the plain build. */
export function hasStages(options: CliOptions): boolean {
	return options.sign === true || options.notarize === true || options.dmg === true;
}

/** Run the requested stages in release order on the freshly built bundle. */
export async function runStages(
	bundle: string,
	options: CliOptions,
	config: CrustConfig,
	seams: StageSeams = {},
): Promise<number> {
	const env = seams.env ?? process.env;
	if (options.sign) {
		const code = await (seams.sign ?? signStage)(
			bundle,
			env.CRUST_SIGNING_IDENTITY!.trim(),
			config.security?.microphone !== undefined,
		);
		if (code !== 0) return code;
	}
	if (options.notarize) {
		const code = await (seams.notarize ?? notarizeStage)(bundle, env, seams.exec);
		if (code !== 0) return code;
	}
	if (options.dmg) {
		const code = await (seams.dmg ?? dmgStage)(
			dmgOptions({ dir: options.dir, config, bundle, dist: dirname(bundle) }),
		);
		if (code !== 0) return code;
	}
	return 0;
}
