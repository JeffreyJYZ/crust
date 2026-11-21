/** The `updater.relaunch` command body: the own-bundle gate, the launch, and its typed answer. */

import {
	invalidArguments,
	notAppBundle,
	platformFailure,
	type UpdaterError,
	type UpdaterFailure,
} from "./updater-args";
import type { BundleArgs, RelaunchResult, UpdaterAdapter } from "./updater-types";

/** The same launcher `install` uses once its swap has landed. */
export type Launch = (appPath: string) => Promise<UpdaterError | undefined>;

export async function runRelaunch(
	args: BundleArgs,
	adapter: UpdaterAdapter,
	start: Launch,
	platform: string,
): Promise<RelaunchResult | UpdaterFailure> {
	if (platform !== "darwin") return platformFailure("relaunch", platform);
	const appPath = (args as { appPath?: unknown } | null)?.appPath;
	if (typeof appPath !== "string" || appPath.trim() === "") {
		return invalidArguments("relaunch", "needs { appPath }", args);
	}
	if (!(await adapter.isAppBundle(appPath))) {
		return notAppBundle(appPath, "is not an existing .app directory", "relaunch");
	}
	const failure = await start(appPath);
	if (failure !== undefined) return { ok: false, ...failure, path: appPath };
	return { ok: true, started: true };
}
