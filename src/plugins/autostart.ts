/**
 * `crust:autostart` — launch at login on macOS, the half of Tauri's autostart plugin crust lacked. The
 * mechanism is a LaunchAgent: `~/Library/LaunchAgents/<bundle-id>.plist` with `RunAtLoad`, written to a
 * sibling temp file and renamed so launchd never reads a half plist. Every command answers a typed result
 * instead of throwing, and a refusal names the path it refused.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { definePlugin } from "./define";

/** Where the plist goes. `home` is injected so a test never writes the real `~/Library`. */
export interface AutostartAdapter {
	home: string;
	/** Bundle id the plist is named for; `enable` falls back to the app's own `Info.plist`. */
	bundleId?: string;
}

export type AutostartFailureCode = "bad-request" | "not-found" | "handler-error";

export interface AutostartFailure {
	ok: false;
	code: AutostartFailureCode;
	message: string;
}

export interface AutostartStatus {
	ok: true;
	enabled: boolean;
	/** Absolute path of the plist this answer is about. */
	plistPath: string;
}

export type AutostartResult = AutostartStatus | AutostartFailure;

export interface EnableArgs {
	/** Absolute path of the `.app` bundle. A bare executable needs an explicit `bundleId`. */
	appPath: string;
	bundleId?: string;
}

export interface AutostartIdArgs {
	bundleId?: string;
}

function fail(code: AutostartFailureCode, message: string): AutostartFailure {
	return { ok: false, code, message };
}

function reasonOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function plistPath(adapter: AutostartAdapter, bundleId: string): string {
	return join(adapter.home, "Library", "LaunchAgents", `${bundleId}.plist`);
}

const BUNDLE_ID = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/;

/** The id an app bundle declares, so a caller does not have to repeat it. */
async function bundleIdFromApp(appPath: string): Promise<string | undefined> {
	const info = appPath.endsWith(".app")
		? join(appPath, "Contents", "Info.plist")
		: join(appPath, "Info.plist");
	const text = await readFile(info, "utf8").catch(() => undefined);
	return text === undefined ? undefined : BUNDLE_ID.exec(text)?.[1];
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function plistDocument(bundleId: string, appPath: string): string {
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

/** Write beside the target then rename, so the plist is either absent or complete. */
async function writeAtomic(target: string, contents: string): Promise<void> {
	const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temp, contents, { encoding: "utf8", mode: 0o644 });
	await rename(temp, target);
}

export function createAutostartPlugin(adapter: AutostartAdapter = { home: homedir() }) {
	/** The id the last `enable` used, so `disable`/`isEnabled` need no argument after one call. */
	let known: string | undefined;

	const resolveId = (given?: string): string | undefined => given ?? adapter.bundleId ?? known;

	const unknownId = (command: string): AutostartFailure =>
		fail(
			"bad-request",
			`autostart.${command}: no bundle id known; pass bundleId, or call enable with the app path first`,
		);

	return definePlugin({
		name: "autostart",
		commands: {
			enable: async (args: EnableArgs | undefined): Promise<AutostartResult> => {
				const appPath = args?.appPath;
				if (typeof appPath !== "string" || appPath.length === 0) {
					return fail(
						"bad-request",
						'autostart.enable: "appPath" must be a non-empty string',
					);
				}
				const present = await stat(appPath).then(
					() => true,
					() => false,
				);
				if (!present) return fail("not-found", `autostart.enable: no app at ${appPath}`);
				const bundleId = resolveId(args?.bundleId) ?? (await bundleIdFromApp(appPath));
				if (bundleId === undefined) {
					return fail(
						"bad-request",
						`autostart.enable: no bundle id for ${appPath}; pass bundleId, or give the app a CFBundleIdentifier in its Info.plist`,
					);
				}
				const target = plistPath(adapter, bundleId);
				try {
					await mkdir(dirname(target), { recursive: true });
					await writeAtomic(target, plistDocument(bundleId, appPath));
				} catch (error) {
					return fail("handler-error", `autostart.enable: ${reasonOf(error)}`);
				}
				known = bundleId;
				return { ok: true, enabled: true, plistPath: target };
			},
			disable: async (args: AutostartIdArgs | undefined): Promise<AutostartResult> => {
				const bundleId = resolveId(args?.bundleId);
				if (bundleId === undefined) return unknownId("disable");
				const target = plistPath(adapter, bundleId);
				try {
					await rm(target, { force: true });
				} catch (error) {
					return fail("handler-error", `autostart.disable: ${reasonOf(error)}`);
				}
				return { ok: true, enabled: false, plistPath: target };
			},
			isEnabled: async (args: AutostartIdArgs | undefined): Promise<AutostartResult> => {
				const bundleId = resolveId(args?.bundleId);
				if (bundleId === undefined) return unknownId("isEnabled");
				const target = plistPath(adapter, bundleId);
				const enabled = await stat(target).then(
					() => true,
					() => false,
				);
				return { ok: true, enabled, plistPath: target };
			},
		},
	});
}

/** The default registration: the real `~/Library/LaunchAgents`, bundle id supplied by the app. */
export const autostartPlugin = createAutostartPlugin();
