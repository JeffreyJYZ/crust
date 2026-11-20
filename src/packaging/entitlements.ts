/**
 * The hardened-runtime entitlements crust seals, and when each one is required.
 *
 * `allow-jit` is the documented JIT entitlement and is required, but it is **not sufficient**: it
 * permits `MAP_JIT` pages while the TinyCC inside Bun writes machine code into ordinary unsigned
 * executable memory. Sealed with `allow-jit` alone, a signed app starts, creates no page, prints
 * nothing and exits 0 — measured on a notify probe, where only the silence showed it.
 * `allow-unsigned-executable-memory` is what makes the same bundle run. Both measured 2026-11-14.
 *
 * `device.audio-input` is what a hardened-runtime bundle needs before WebKit's `getUserMedia` can
 * ask for the microphone. It ships only when the app opted in, because it is a real capability the
 * signature grants to the whole process.
 */

/** One `key` + `<true/>` pair at the dict's own indent. */
function entitlement(key: string): string {
	return `\t<key>${key}</key>\n\t<true/>\n`;
}

export interface EntitlementOptions {
	/** `com.apple.security.device.audio-input`; enabled by `security.microphone`. */
	microphone?: boolean;
}

/**
 * The entitlement plist for a hardened-runtime signature. `JIT_ENTITLEMENT_PLIST` is the same
 * output for an app that captures nothing, so the two-key form stays byte-exact.
 */
export function hardenedEntitlements(options: EntitlementOptions = {}): string {
	const microphone = options.microphone
		? entitlement("com.apple.security.device.audio-input")
		: "";
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entitlement("com.apple.security.cs.allow-jit")}${entitlement("com.apple.security.cs.allow-unsigned-executable-memory")}${microphone}</dict>
</plist>
`;
}

/** The measured two-key entitlement set, and the default for every app that captures nothing. */
export const JIT_ENTITLEMENT_PLIST = hardenedEntitlements();
