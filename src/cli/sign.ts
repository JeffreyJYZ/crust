import { loadConfig } from "@/config";
import {
	assessGatekeeper,
	describeSignature,
	signApp,
	type SignResult,
	signingReality,
	verifySignature,
} from "@/packaging/sign";
import { fail, findAppBundle, line, type CliOptions } from "./util.ts";

/**
 * The honest verdict comes from the shared helper, not a second hand-written copy
 * that can drift from what `signingReality()` promises in the sign module.
 */
export function signVerdict(result: SignResult): string[] {
	return [
		...signingReality(result),
		"notarize not run — needs notarytool credentials, then `stapler staple`",
	];
}

/**
 * `crust sign` — the Developer ID path, hardened runtime, JIT entitlement. Without a certificate there is nothing honest to do, so it fails naming the environment variable. `crust build`'s ad-hoc signature is local-only: it cannot be notarized, so Gatekeeper refuses it elsewhere.
 */
export async function sign(options: CliOptions): Promise<number> {
	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust sign — ${loaded.path}`);

	const identity = process.env.CRUST_SIGNING_IDENTITY;
	if (!identity) {
		return fail(
			"sign",
			'no signing identity — set CRUST_SIGNING_IDENTITY="Developer ID Application: ' +
				'Name (TEAMID)". Without one, `crust build` ad-hoc signs with `codesign --sign -`, ' +
				"which Gatekeeper refuses on any other machine.",
		);
	}

	const bundle = await findAppBundle(options.dir, { appName: loaded.config.app.name });
	if (!bundle) {
		return fail("sign", `no .app in ${options.dir}/dist — run crust build first`);
	}

	line("identity", identity);
	line("bundle", bundle);

	const result = await signApp({
		appPath: bundle,
		mode: "developer-id",
		identity,
		hardenedRuntime: true,
	});
	for (const text of signVerdict(result)) line("sign", text);

	const verified = await verifySignature(bundle);
	if (!verified.valid) {
		return fail(
			"sign",
			`codesign --verify --strict failed (${verified.exitCode}): ${verified.output}`,
		);
	}
	line("verify", "codesign --verify --strict passed");

	const gatekeeper = await assessGatekeeper(bundle);
	line(
		"gatekeeper",
		gatekeeper.accepted
			? "spctl accepts the bundle"
			: `spctl still refuses until notarization is stapled (exit ${gatekeeper.exitCode})`,
	);
	line("signature", (await describeSignature(bundle)).split("\n")[0] ?? "unreadable");
	return 0;
}
