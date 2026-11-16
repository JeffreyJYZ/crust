/**
 * Starting a bundle, and which bundle this process may start: `relaunch` must start this app's own
 * bundle and nothing else, because a page that names an arbitrary `.app` would otherwise get an
 * arbitrary program started. The answer comes from `process.execPath`
 * (`…/X.app/Contents/MacOS/X` → `…/X.app`), resolved through `realpath`, so a symlink to this app's
 * bundle is that bundle and a symlink out of it is not.
 */

import { lstat, realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { errorOf, notAppBundle, type UpdaterError, type UpdaterFailure } from "./updater-args";
import type { UpdaterAdapter } from "./updater-types";

/** `…/X.app/Contents/MacOS/X` → `…/X.app`, or `undefined` when the executable is not in a bundle. */
export function ownBundleOf(execPath: string): string | undefined {
	const macos = dirname(execPath);
	const contents = dirname(macos);
	const bundle = dirname(contents);
	if (basename(macos) !== "MacOS" || basename(contents) !== "Contents") return undefined;
	return bundle.endsWith(".app") ? bundle : undefined;
}

/** The resolved own bundle, or `undefined` when this process cannot tell which bundle is its own. */
export async function ownBundle(execPath: string): Promise<string | undefined> {
	const bundle = ownBundleOf(execPath);
	if (bundle === undefined) return undefined;
	return await realpath(bundle).catch(() => undefined);
}

/** A refusal when `appPath` is not this process's own bundle, `undefined` when it is. */
export async function ownBundleFailure(
	appPath: string,
	execPath: string,
	command: "install" | "relaunch" = "relaunch",
): Promise<UpdaterFailure | undefined> {
	const own = await ownBundle(execPath);
	const verb = command === "install" ? "install only replaces" : "relaunch only starts";
	if (own === undefined) {
		// A dev run has no bundle to be its own, so it refuses rather than guessing which one.
		const message =
			`crust: updater.${command}: refuses ${appPath}: cannot tell which bundle is its own, ` +
			`because ${execPath} is not inside an .app`;
		return { ok: false, code: "not-an-app-bundle", message, path: appPath };
	}
	const target = await realpath(appPath).catch(() => undefined);
	if (target === own) return undefined;
	return notAppBundle(appPath, `is not this app's bundle; ${verb} ${own}`, command);
}

/** A link is not the bundle: renaming over it would replace the link and leave the app alone. */
export async function linkedPath(appPath: string): Promise<UpdaterFailure | undefined> {
	const info = await lstat(appPath).catch(() => undefined);
	if (info?.isSymbolicLink() !== true) return undefined;
	const message =
		`crust: updater.install: ${appPath} is a symlink; install replaces the bundle itself, ` +
		"not a link to it, because a rename over a link would leave the app in place";
	return { ok: false, code: "not-an-app-bundle", message, path: appPath };
}

/** The launch seam: the own-bundle gate, then the adapter; a refusal or a throw is the answer. */
export function createLauncher(adapter: UpdaterAdapter, execPath: string) {
	return async (appPath: string): Promise<UpdaterError | undefined> => {
		const refused = await ownBundleFailure(appPath, execPath, "relaunch");
		if (refused !== undefined) return refused;
		if (adapter.relaunch === undefined) {
			return { code: "relaunch-failed", message: "crust: updater.relaunch: no launcher" };
		}
		try {
			await adapter.relaunch(appPath);
			return undefined;
		} catch (error) {
			return errorOf(error, "relaunch-failed");
		}
	};
}
