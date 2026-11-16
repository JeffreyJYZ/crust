/**
 * The half of notarization that is a pure value: the commands, in order, and the two states no command can fix, so a test reads the exact argv without a certificate. `notarize.ts` runs the plan; `sign.ts` measured why ad-hoc can never reach Apple.
 */

import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { RunResult } from "./exec";

/** The shape of `run`, so a test records argv without spawning anything. */
export type Exec = (command: string[]) => Promise<RunResult>;

export interface NotarizeOptions {
	/** Path to the signed `.app`. */
	appPath: string;
	/** `codesign` identity; `-` or empty is ad-hoc, which Apple never notarizes. */
	identity: string;
	/** Required by the `appleId` route: notarytool needs `--team-id` with it. */
	teamId?: string;
	/** A `notarytool store-credentials` keychain profile; wins when both routes are set. */
	profile?: string;
	/** One-shot submit credentials, used only when `profile` is absent. */
	appleId?: string;
	password?: string;
	/** Defaults to `run`; a test passes a recorder. */
	exec?: Exec;
}

export type CredentialRoute =
	| { kind: "profile"; profile: string }
	| { kind: "apple-id"; appleId: string; password: string; teamId: string };

export interface NotarizeRefusal {
	ok: false;
	reason: string;
	requires: string;
}

export type NotarizePreflight = { ok: true } | NotarizeRefusal;

export type NotarizeStatus = "accepted" | "invalid" | "rejected";

export type NotarizeStepName = "zip" | "submit" | "staple" | "validate" | "spctl";

export interface NotarizeStep {
	name: NotarizeStepName;
	command: string[];
}

export interface NotarizePlan {
	appPath: string;
	zipPath: string;
	steps: NotarizeStep[];
}

export interface NotarizeResult {
	ok: boolean;
	status?: NotarizeStatus;
	appPath: string;
	reason?: string;
	requires?: string;
	submissionId?: string;
	/** notarytool's log for the submission, raw. */
	log?: string;
	/** notarytool's `issues` messages, verbatim, never summarised. */
	issues?: string[];
}

export const ADHOC_REQUIRES = "a Developer ID Application certificate";
export const CREDENTIAL_REQUIRES = "notarytool store-credentials <profile> or appleId + password";

export function credentialRoute(options: NotarizeOptions): CredentialRoute | undefined {
	const profile = options.profile?.trim();
	if (profile) return { kind: "profile", profile };
	const appleId = options.appleId?.trim();
	const password = options.password?.trim();
	const teamId = options.teamId?.trim();
	if (appleId && password && teamId) return { kind: "apple-id", appleId, password, teamId };
	return undefined;
}

/** The flags notarytool reads credentials from, identical for `submit` and `log`. */
export function credentialFlags(route: CredentialRoute): string[] {
	if (route.kind === "profile") return ["--keychain-profile", route.profile];
	return ["--apple-id", route.appleId, "--password", route.password, "--team-id", route.teamId];
}

/** The two states no command can fix, so both are decided before one runs. */
export function refusal(options: NotarizeOptions): NotarizeRefusal | undefined {
	const identity = options.identity.trim();
	if (identity.length === 0 || identity === "-") {
		return {
			ok: false,
			reason: "ad-hoc identity cannot be notarized",
			requires: ADHOC_REQUIRES,
		};
	}
	if (!credentialRoute(options)) {
		return { ok: false, reason: "no notarytool credential", requires: CREDENTIAL_REQUIRES };
	}
	return undefined;
}

export function preflightNotarize(options: NotarizeOptions): NotarizePreflight {
	return refusal(options) ?? { ok: true };
}

/** The exact argv, in order: `--keepParent` keeps the `.app` at the zip root, the shape notarytool expects, and `--wait` is what makes the answer a verdict rather than a ticket. */
export function buildNotarizePlan(options: NotarizeOptions, zipPath?: string): NotarizePlan {
	const blocked = refusal(options);
	if (blocked) throw new Error(`${blocked.reason}; requires ${blocked.requires}`);
	const route = credentialRoute(options);
	if (!route) throw new Error(`no notarytool credential; requires ${CREDENTIAL_REQUIRES}`);

	const appPath = options.appPath;
	const zip = zipPath ?? join(tmpdir(), "crust-notarize", `${basename(appPath)}.zip`);
	const submit = ["xcrun", "notarytool", "submit", zip, ...credentialFlags(route)];

	return {
		appPath,
		zipPath: zip,
		steps: [
			{ name: "zip", command: ["ditto", "-c", "-k", "--keepParent", appPath, zip] },
			{ name: "submit", command: [...submit, "--wait", "--output-format", "json"] },
			{ name: "staple", command: ["xcrun", "stapler", "staple", appPath] },
			{ name: "validate", command: ["xcrun", "stapler", "validate", appPath] },
			{ name: "spctl", command: ["spctl", "-a", "-vvv", "-t", "install", appPath] },
		],
	};
}

/** One line a CLI can print without inventing a second verdict format; issues follow verbatim. */
export function describeNotarize(result: NotarizeResult): string {
	if (!result.status) {
		const reason = result.reason ?? "unknown reason";
		const requires = result.requires ?? "unknown requirement";
		return `notarize refused   ${reason} — requires ${requires}`;
	}
	const id = result.submissionId ? `  ${result.submissionId}` : "";
	const lines = [`notarize ${result.status.padEnd(9)}${id}  ${result.appPath}`];
	for (const issue of result.issues ?? []) lines.push(`  ${issue}`);
	return lines.join("\n");
}
