/**
 * The `Info.plist` crust writes into every bundle, and the key lists the
 * release verifier checks against.
 */

/**
 * String-valued keys `verify-release` insists on. Exported so the verifier and
 * the writer cannot drift: one list, both sides.
 */
export const REQUIRED_PLIST_STRINGS = [
	"CFBundleIdentifier",
	"CFBundleExecutable",
	"CFBundleName",
	"CFBundlePackageType",
	"CFBundleShortVersionString",
	"LSMinimumSystemVersion",
] as const;

/**
 * App Transport Security keys, and the measured reason both ship.
 *
 * `NSAllowsArbitraryLoadsInWebContent` is the key that actually governs a
 * `WKWebView` load over plain http. `NSAllowsLocalNetworking` does *not*
 * reliably cover a bare IP address on macOS 14 and later, so it cannot be
 * substituted — but it is free, it covers the `localhost` case, and it is what
 * Apple documents, so every generated plist carries both.
 */
export const ATS_KEYS = ["NSAllowsArbitraryLoadsInWebContent", "NSAllowsLocalNetworking"] as const;

/** `PkgInfo` is these eight bytes, always. `APPL` is a packaged application. */
export const PKG_INFO = "APPL????";

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The Info.plist body, as XML.
 *
 * Written by hand rather than through `plutil` or a plist library: it is ~30
 * lines, it needs no round trip, and the output is reviewable in a diff, which
 * is what makes "every required key is present" a code-read rather than a
 * test.
 */
export function infoPlist(options: {
	executableName: string;
	name: string;
	id: string;
	version: string;
	minimumSystemVersion: string;
	/** Whether `Resources/icon.icns` was written. */
	hasIcon: boolean;
}): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>${escapeXml(options.executableName)}</string>
	<key>CFBundleIdentifier</key>
	<string>${escapeXml(options.id)}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${escapeXml(options.name)}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${escapeXml(options.version)}</string>
	<key>CFBundleVersion</key>
	<string>${escapeXml(options.version)}</string>
	<key>LSMinimumSystemVersion</key>
	<string>${escapeXml(options.minimumSystemVersion)}</string>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoadsInWebContent</key>
		<true/>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
	${
		options.hasIcon
			? `<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	`
			: ""
	}</dict>
</plist>
`;
}
