/**
 * The ad-hoc signature `crust build` puts on a freshly assembled bundle on darwin.
 *
 * Split out of `build.ts`, which sat at the 200-line cap: signing is its own step and its own
 * failure reasons. codesign treats every file in `Contents/MacOS` as nested code, so a sidecar
 * copied there fails the bundle seal with "code object is not signed at all" unless it carries its
 * own signature first. The manifest is in `Contents/Resources` for the same reason.
 */

import { dirname, resolve } from "node:path";

import type { CrustConfig } from "@/config";
import type { AssembledApp } from "@/packaging/app";
import { runOrThrow } from "@/packaging/exec";
import { signApp } from "@/packaging/sign";

/** Sign the sidecars, then the bundle. `security.microphone` rides into the entitlement plist. */
export async function signAdhoc(assembled: AssembledApp, config: CrustConfig): Promise<void> {
	const sidecarDir = dirname(assembled.executablePath);
	for (const name of config.build?.sidecars ?? []) {
		const sidecar = resolve(sidecarDir, ...name.split(/[\\/]/));
		await runOrThrow(["codesign", "--force", "--sign", "-", "--timestamp=none", sidecar]);
	}
	await signApp({
		appPath: assembled.appPath,
		mode: "adhoc",
		microphone: config.security?.microphone !== undefined,
	});
}
