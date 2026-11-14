import { loadConfig } from "@/config";
import { assessGatekeeper, describeSignature, signApp, verifySignature } from "@/packaging/sign";
import { fail, findAppBundle, line, type CliOptions } from "./util.ts";

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

	const bundle = await findAppBundle(options.dir);
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
	line("signed", `${result.mode}, hardened runtime, JIT entitlement sealed`);

	const verified = await verifySignature(bundle);
	if (!verified.valid) {
		return fail("sign", `codesign --verify failed (${verified.exitCode}): ${verified.output}`);
	}
	line("verify", "codesign --verify --strict passed");

	line("notarize", "not run — needs notarytool credentials, then `stapler staple`");
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
