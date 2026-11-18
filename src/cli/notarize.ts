/**
 * `crust notarize` — the preflight decides first, because on a machine with no
 * Developer ID certificate the honest answer is the refusal, not a bundle lookup
 * that would send the user off to build something Apple would still reject.
 */

import { resolve } from "node:path";
import { loadConfig } from "@/config";
import {
	type Exec,
	type NotarizeOptions,
	describeNotarize,
	notarize,
	preflightNotarize,
} from "@/packaging/notarize";
import { fail, findAppBundle, type CliOptions } from "./util.ts";

/** The tool runner, injected by a test so no command reaches Apple. */
export interface NotarizeSeams {
	exec?: Exec;
}

/** Credentials come from the environment, never argv: a password on a command line lands in shell history and `ps`. */
function credentials(): Omit<NotarizeOptions, "appPath" | "exec"> {
	return {
		identity: process.env.CRUST_SIGNING_IDENTITY ?? "",
		profile: process.env.CRUST_NOTARY_PROFILE,
		appleId: process.env.CRUST_NOTARY_APPLE_ID,
		password: process.env.CRUST_NOTARY_PASSWORD,
		teamId: process.env.CRUST_NOTARY_TEAM_ID,
	};
}

export async function notarizeCommand(
	options: CliOptions,
	seams: NotarizeSeams = {},
): Promise<number> {
	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust notarize — ${loaded.path}`);

	// Preflight runs no command, so the path it carries is only a placeholder.
	const preflight = preflightNotarize({
		appPath: resolve(options.dir, "dist"),
		...credentials(),
	});
	if (!preflight.ok) {
		console.log(
			describeNotarize({
				ok: false,
				appPath: resolve(options.dir, "dist"),
				reason: preflight.reason,
				requires: preflight.requires,
			}),
		);
		return 1;
	}

	const bundle = await findAppBundle(options.dir, { appName: loaded.config.app.name });
	if (!bundle) {
		return fail(
			"notarize",
			`no .app in ${resolve(options.dir, "dist")} — run crust build first`,
		);
	}

	const result = await notarize({ ...credentials(), appPath: bundle, exec: seams.exec });
	console.log(describeNotarize(result));
	return result.ok ? 0 : 1;
}
