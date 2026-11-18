/**
 * The bundle already on disk and its Gatekeeper consequence: what a recipient
 * of this build would meet.
 */

import { loadConfig } from "@/config";
import { describeSignature } from "@/packaging/sign";
import { findBuildArtifact } from "../util.ts";
import type { Check } from "./check.ts";

export async function checkBundle(dir: string): Promise<Check[]> {
	// Doctor inspects whatever is on disk, including a project whose config is
	// absent or broken — keep the artefact lookup best-effort when config fails.
	const appName = await loadConfig({ dir })
		.then((loaded) => loaded.config.app.name)
		.catch(() => undefined);
	const artifact = await findBuildArtifact(dir, { appName });
	if (!artifact)
		return [
			{
				name: "bundle",
				status: "note",
				detail: "no build artefact in dist — run crust build first",
			},
		];

	const checks: Check[] = [{ name: "bundle", status: "note", detail: artifact }];
	const signature = await describeSignature(artifact).catch(() => undefined);
	const adHoc = signature?.includes("adhoc") ?? false;
	checks.push({
		name: "gatekeeper",
		status: "note",
		detail: adHoc
			? "ad-hoc signed: refused elsewhere until a Developer ID signature exists"
			: "signature state unknown — `crust sign` needs CRUST_SIGNING_IDENTITY",
	});
	return checks;
}
