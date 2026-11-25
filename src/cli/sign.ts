import { join, resolve } from "node:path";
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
 * Resolve declared sidecar names to the paths codesign must re-sign, deepest first: a nested
 * artefact is sealed before the directory that holds it, and every one is sealed before the
 * `.app`. Pure so the ordering is provable without a certificate.
 */
export function signSidecarPaths(bundle: string, names: readonly string[]): string[] {
	const macos = join(bundle, "Contents", "MacOS");
	return names
		.map((name) => resolve(macos, ...name.split(/[\\/]/)))
		.sort((a, b) => b.split(/[\\/]/).length - a.split(/[\\/]/).length);
}

/**
 * The Developer ID stage inside `crust build --sign`: hardened runtime and the
 * JIT entitlement replace the ad-hoc signature the build applied. Every declared sidecar is
 * re-signed with the same identity first — codesign never re-signs already-signed nested code.
 * No identity ever reaches here on an uncredentialed machine — `stageRefusal` refuses first.
 */
export async function signStage(
	bundle: string,
	identity: string,
	microphone = false,
	sidecars: readonly string[] = [],
): Promise<number> {
	line("identity", identity);
	line("bundle", bundle);

	const sidecarPaths = signSidecarPaths(bundle, sidecars);
	if (sidecarPaths.length > 0) {
		line(
			"sidecars",
			`${sidecarPaths.length} re-signed with the Developer ID before the bundle`,
		);
	}
	const result = await signApp({
		appPath: bundle,
		mode: "developer-id",
		identity,
		hardenedRuntime: true,
		microphone,
		sidecars: sidecarPaths,
	});
	for (const text of signVerdict(result)) line("sign", text);

	const verified = await verifySignature(bundle);
	if (!verified.valid) {
		return fail(
			"build",
			`codesign --verify --strict --deep failed (${verified.exitCode}): ${verified.output}`,
		);
	}
	line("verify", "codesign --verify --strict --deep passed");

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
