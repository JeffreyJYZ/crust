/**
 * The notarize stage of `crust build --notarize`. Preflight decides first: on a
 * machine with no Developer ID certificate the honest answer is the refusal,
 * not a bundle lookup that sends the user off to build something Apple refuses.
 */

import {
	type Exec,
	type NotarizeOptions,
	describeNotarize,
	notarize,
	preflightNotarize,
} from "@/packaging/notarize";

/** Credentials come from the environment, never argv: a password on a command line lands in shell history and `ps`. */
export function notarizeEnv(
	env: NodeJS.ProcessEnv = process.env,
): Omit<NotarizeOptions, "appPath" | "exec"> {
	return {
		identity: env.CRUST_SIGNING_IDENTITY ?? "",
		profile: env.CRUST_NOTARY_PROFILE,
		appleId: env.CRUST_NOTARY_APPLE_ID,
		password: env.CRUST_NOTARY_PASSWORD,
		teamId: env.CRUST_NOTARY_TEAM_ID,
	};
}

/** Submit the signed bundle, staple the ticket, validate it and ask Gatekeeper. */
export async function notarizeStage(
	appPath: string,
	env: NodeJS.ProcessEnv = process.env,
	exec?: Exec,
): Promise<number> {
	const options = { appPath, ...notarizeEnv(env) };
	const preflight = preflightNotarize(options);
	if (!preflight.ok) {
		console.log(describeNotarize({ ...preflight, appPath }));
		return 1;
	}

	const result = await notarize({ ...options, exec });
	console.log(describeNotarize(result));
	return result.ok ? 0 : 1;
}
