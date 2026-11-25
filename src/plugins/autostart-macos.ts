/**
 * macOS's login item: a LaunchAgent at `~/Library/LaunchAgents/<id>.plist` with `RunAtLoad`, which
 * launchd reads at the next login — nothing here calls `launchctl`. The document is written by
 * `autostart-mechanism.ts`'s atomic rename, so launchd never reads a half plist.
 *
 * launchd passes `ProgramArguments[0]` straight to `execve`. A `.app` is a *directory*, so pointing
 * at the bundle makes the job fail at login while the plist still exists — which is why `enable`
 * answered `enabled: true` for an entry nothing could run. A bundle is launched through
 * `/usr/bin/open <bundle>`; a bare executable is named directly. `enabled` reads the plist back
 * and answers from what launchd would actually exec, not from a bare `stat` of the plist.
 */

import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { type AutostartMechanism, exists, writeAtomic } from "./autostart-mechanism";

/** The macOS launcher that turns a bundle directory into something `execve` can run. */
export const BUNDLE_LAUNCHER = "/usr/bin/open";

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function unescapeXml(value: string): string {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&gt;", ">")
		.replaceAll("&lt;", "<")
		.replaceAll("&amp;", "&");
}

/** The argv launchd will pass to `execve`: a bundle needs the launcher, an executable does not. */
export function programArguments(appPath: string): readonly string[] {
	return appPath.endsWith(".app") ? [BUNDLE_LAUNCHER, appPath] : [appPath];
}

export function plistDocument(bundleId: string, appPath: string): string {
	const entries = programArguments(appPath)
		.map((argument) => `\t\t<string>${escapeXml(argument)}</string>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${escapeXml(bundleId)}</string>
	<key>ProgramArguments</key>
	<array>
${entries}
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`;
}

/** What the written plist actually names, read from the document rather than remembered. */
export function plistProgramArguments(text: string): string[] {
	const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1];
	if (block === undefined) return [];
	return [...block.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) =>
		unescapeXml(match[1] ?? ""),
	);
}

async function launchable(path: string): Promise<boolean> {
	// `/usr/bin/open` is the launcher this build writes; tests inject a home but run on any OS, so
	// its presence must not be what makes a plist answer enabled on a non-macOS machine.
	if (path === BUNDLE_LAUNCHER) return true;
	try {
		const info = await stat(path);
		return info.isFile() && (info.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

/**
 * The LaunchAgent `home` would hold for this id; `home` is injected so a test never writes the real one.
 */
export function macosMechanism(home: string, bundleId: string): AutostartMechanism {
	const path = join(home, "Library", "LaunchAgents", `${bundleId}.plist`);
	return {
		path,
		write: async (appPath) => await writeAtomic(path, plistDocument(bundleId, appPath)),
		enabled: async () => {
			if (!(await exists(path))) return false;
			const text = await readFile(path, "utf8").catch(() => undefined);
			if (text === undefined) return false;
			const argv = plistProgramArguments(text);
			const first = argv[0];
			if (first === undefined || !(await launchable(first))) return false;
			// `/usr/bin/open` with no bundle argument would launch nothing either.
			if (first === BUNDLE_LAUNCHER)
				return argv.length === 2 && (await exists(argv[1] ?? ""));
			return true;
		},
		remove: async () => await rm(path, { force: true }),
	};
}
