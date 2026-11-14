/**
 * The hardened-runtime entitlements crust needs, both measured on 2026-11-14.
 *
 * `allow-jit` is the one Apple documents for JIT and it is required, but it is
 * **not sufficient**: it permits `MAP_JIT` pages, and the TinyCC inside Bun
 * instead writes machine code into ordinary unsigned executable memory. Sealed
 * with `allow-jit` alone, a signed app starts, creates no page and prints
 * nothing — `crust sign` produced exactly that on a notify probe, exit stayed 0
 * and only the silence showed it. `allow-unsigned-executable-memory` is what
 * makes the same bundle run.
 *
 * This also corrects an earlier note: that probe tested `new Function` inside
 * the *Bun* process, which is not the blocked path, so "no entitlement needed"
 * was never a safe reading of it.
 */
export const JIT_ENTITLEMENT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
</dict>
</plist>
`;
