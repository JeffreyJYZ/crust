/**
 * `crust:crash-reporter` — what the app knows about its own last crash. The reporting itself happens in a second process (`runtime-crash-guard.ts`), so `last`, `list` and `clear` read or arm; none of them can run inside a process that is already faulting.
 * The rule this file enforces: **a guard that was never started is named, not papered over.** Without it nothing ever writes a record, so `last`, `list` and `clear` answer a typed `NotImplemented` naming `startCrashGuard()` instead of an empty list that reads like "no crashes".
 * The page also reports, because the ordinary crash is an `onerror` in a render loop that never faults the process. `report` is that half; `configure` repoints where its records land.
 */

import { readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { crashRecordPath } from "../platform/darwin/crash-record";
import { listCrashes, readLastCrash, recordPageCrash } from "../runtime-crash-store";
import {
	type ClearRefused,
	type ConfigureCrashArgs,
	type CrashReporterOptions,
	type ConfigureCrashResult,
	type ConfigureRefused,
	type InstallResult,
	type LastCrashResult,
	type ListCrashesArgs,
	type ListCrashesResult,
	type ReportCrashArgs,
	type ReportCrashResult,
	type UninstallResult,
} from "./crash-reporter-types";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export type * from "./crash-reporter-types";

/** The one message every guard-less command answers, so the missing half is named once. */
const NO_GUARD = "crash-reporter: the helper process is not running";

export function createCrashReporterPlugin(options: CrashReporterOptions = {}): PluginDefinition<
	"crash-reporter",
	{
		last: () => LastCrashResult | NotImplemented;
		list: (args?: ListCrashesArgs) => ListCrashesResult | NotImplemented;
		report: (args: ReportCrashArgs) => ReportCrashResult | NotImplemented;
		configure: (args: ConfigureCrashArgs) => ConfigureCrashResult | ConfigureRefused;
		clear: () => ClearRefused | NotImplemented;
		install: () => InstallResult | NotImplemented;
		uninstall: () => UninstallResult | NotImplemented;
	}
> {
	const dataRoot =
		options.root ??
		join(options.home ?? homedir(), "Library", "Application Support", options.appId ?? "crust");
	// `configure` repoints this; the data root stays the fence a new directory is measured against.
	let root = dataRoot;
	const guardRunning = (): boolean => options.guard?.running() === true;
	const noGuard = (): NotImplemented => notImplemented(NO_GUARD, "startCrashGuard()");
	const noNative = (command: string): NotImplemented =>
		notImplemented(
			`crash-reporter.${command} needs the darwin signal unit: only that half can install a handler that survives a fault. Pass a CrashNative to createCrashReporterPlugin on a platform without it.`,
			"armCrashHandlers()",
		);

	/**
	 * The real location of `path`, for the fence below. `realpathSync` follows symlinks, so a link
	 * inside the data root pointing outside resolves outside and is refused. A dangling link's target
	 * is read explicitly — a parent-only fallback would wave a link whose target does not exist yet
	 * through the fence, and a later write would follow it out. `seen` bounds a link cycle.
	 */
	const realCanonical = (path: string, seen: Set<string> = new Set()): string => {
		let found: string | undefined;
		try {
			found = realpathSync(path);
		} catch {
			found = undefined;
		}
		if (found !== undefined) return found;
		const parent = dirname(path);
		if (parent === path || seen.has(path)) return path;
		let link: string | undefined;
		try {
			link = readlinkSync(path);
		} catch {
			link = undefined;
		}
		if (link !== undefined) {
			seen.add(path);
			return realCanonical(resolve(parent, link), seen);
		}
		return join(realCanonical(parent, seen), basename(path));
	};

	/** Inside the data root by real path: a symlink inside it that points out is refused. */
	const insideRoot = (dir: string): boolean => {
		const target = realCanonical(dir);
		const fence = realCanonical(dataRoot);
		if (target === fence) return true;
		return target.startsWith(fence.endsWith(sep) ? fence : `${fence}${sep}`);
	};

	return definePlugin({
		name: "crash-reporter",
		commands: {
			/** The newest crash the guard recorded, or the newest a page reported. */
			last: (): LastCrashResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return { crash: readLastCrash(root), root };
			},
			/** Every recorded crash, oldest first. */
			list: (args?: ListCrashesArgs): ListCrashesResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return { crashes: listCrashes(root, args?.limit), root };
			},
			/**
			 * One record from the page — what an `onerror` in a render loop reports, and the case no
			 * guard can see. Same store, same layout, same `0600`: `type: "webview"` is what separates
			 * it from the guard's `"signal"`, and an over-long field is truncated, never refused.
			 */
			report: (args: ReportCrashArgs): ReportCrashResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return { ok: true, crash: recordPageCrash(root, args), root };
			},
			/**
			 * Where records land. Refused outside the app's data root: a record carries the app's paths,
			 * so writing one wherever a page names is a containment hole. No `url` is accepted —
			 * uploading is a privacy decision the app makes, not one a plugin makes for it.
			 */
			configure: (args: ConfigureCrashArgs): ConfigureCrashResult | ConfigureRefused => {
				const dir = args?.dir;
				if (typeof dir !== "string" || dir.length === 0)
					return { ok: true, dir: root, root };
				if (!isAbsolute(dir) || !insideRoot(dir)) {
					return {
						ok: false,
						code: "outside-data-root",
						message: `crash-reporter.configure: ${dir} is outside the app's data root ${dataRoot}`,
						root,
					};
				}
				root = resolve(dir);
				return { ok: true, dir: root, root };
			},
			/**
			 * Refused from the page. Deleting the evidence is a runtime decision: the runtime calls
			 * `clearCrashes(root)` from `runtime-crash-store.ts`, which is the only caller allowed to.
			 */
			clear: (): ClearRefused | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return {
					ok: false,
					code: "page-cannot-clear",
					message: `crash-reporter.clear: a page cannot delete its own crash evidence; the runtime calls clearCrashes(${root}) instead`,
					root,
				};
			},
			/** Arm the handlers, so the next fault writes a record the guard can read. */
			install: (): InstallResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				if (!options.native) return noNative("install");
				// The guard reads the record from the data root, so `configure` must not move it.
				const record = crashRecordPath(dataRoot);
				const arm = options.native.arm(record);
				return { armed: arm.armed, reason: arm.reason, record, root };
			},
			/** Restore the default disposition, so a fault is a plain fault again. */
			uninstall: (): UninstallResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				if (!options.native) return noNative("uninstall");
				const arm = options.native.disarm();
				return { armed: arm.armed, status: arm.status, reason: arm.reason };
			},
		},
	});
}

/** The default registration: honest about the guard nobody started. */
export const crashReporterPlugin = createCrashReporterPlugin();
