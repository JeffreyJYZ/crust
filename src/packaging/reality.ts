import type { SignResult } from "./sign.ts";

/**
 * The lines a build must print whether or not the user asks. Ad-hoc is rejected by Gatekeeper on every other machine, so printing that on success is the difference between an honest tool and one implying a signed app is shippable.
 */
export function signingReality(result: SignResult): string[] {
	const lines = [
		`signed ${result.appPath} — ${result.mode}${result.hardenedRuntime ? " + hardened runtime" : ""}`,
	];

	if (result.mode === "adhoc") {
		lines.push(
			"spctl rejects this bundle (exit 3): an ad-hoc signature cannot be notarized, " +
				"so it runs local builds only. Distributing it means the recipient clears " +
				"quarantine (xattr -dr com.apple.quarantine) or right-clicks Open, once.",
		);
		lines.push(
			"Distribution requires a Developer ID Application certificate: Developer ID " +
				"codesign, notarytool submit --wait, then stapler staple.",
		);
	}

	if (result.entitled) {
		lines.push(
			"com.apple.security.cs.allow-jit is sealed. Its necessity is unproven for Bun's " +
				"runtime — codegen ran under --options runtime with no entitlement at all. " +
				"WKWebView's WebContent process is the unmeasured case.",
		);
	}

	return lines;
}
