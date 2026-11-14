/**
 * The hardened-runtime entitlements crust needs, both measured 2026-11-14. `allow-jit` is the documented JIT entitlement and is required, but it is **not sufficient**: it permits `MAP_JIT` pages while the TinyCC inside Bun writes machine code into ordinary unsigned executable memory.
 * Sealed with `allow-jit` alone, a signed app starts, creates no page, prints nothing and exits 0 — measured on a notify probe, where only the silence showed it. `allow-unsigned-executable-memory` is what makes the same bundle run.
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
