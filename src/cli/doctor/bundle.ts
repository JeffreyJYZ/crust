/**
 * The bundle already on disk and its Gatekeeper consequence: what a recipient
 * of this build would meet.
 */

import { describeSignature } from "@/packaging/sign";
import { findAppBundle } from "../util.ts";
import type { Check } from "./check.ts";

export async function checkBundle(dir: string): Promise<Check[]> {
	const bundle = await findAppBundle(dir);
	if (!bundle)
		return [
			{ name: "bundle", status: "note", detail: "no .app in dist — run crust build first" },
		];

	const checks: Check[] = [{ name: "bundle", status: "note", detail: bundle }];
	const signature = await describeSignature(bundle).catch(() => undefined);
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
