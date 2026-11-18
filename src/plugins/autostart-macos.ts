/**
 * macOS's login item: a LaunchAgent at `~/Library/LaunchAgents/<id>.plist` with `RunAtLoad`, which
 * launchd reads at the next login — nothing here calls `launchctl`. The document is written by
 * `autostart-mechanism.ts`'s atomic rename, so launchd never reads a half plist.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

import { type AutostartMechanism, exists, writeAtomic } from "./autostart-mechanism";

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function plistDocument(bundleId: string, appPath: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${escapeXml(bundleId)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escapeXml(appPath)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`;
}

/** The LaunchAgent `home` would hold for this id; `home` is injected so a test never writes the real one. */
export function macosMechanism(home: string, bundleId: string): AutostartMechanism {
	const path = join(home, "Library", "LaunchAgents", `${bundleId}.plist`);
	return {
		path,
		write: async (appPath) => await writeAtomic(path, plistDocument(bundleId, appPath)),
		enabled: async () => await exists(path),
		remove: async () => await rm(path, { force: true }),
	};
}
