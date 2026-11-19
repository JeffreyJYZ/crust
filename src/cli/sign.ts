import {
	assessGatekeeper,
	describeSignature,
	signApp,
	type SignResult,
	signingReality,
	verifySignature,
} from "@/packaging/sign";
import { fail, line } from "./util.ts";

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
 * The Developer ID stage inside `crust build --sign`: hardened runtime and the
 * JIT entitlement replace the ad-hoc signature the build applied. No identity
 * ever reaches here — `stageRefusal` refuses the invocation before any work.
 */
export async function signStage(bundle: string, identity: string): Promise<number> {
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
			"build",
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
