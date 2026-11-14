/**
 * The environment half of `crust doctor`: platform, runtime, the macOS floor,
 * and the config — or the single file that needs none.
 *
 * A failure is reported in the order it actually happens, so platform comes
 * before config: a Linux box never reaches the config reader at all.
 */

import { readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { findConfig, loadConfig, type CrustConfig } from "@/config";
import { detectSingle, type SingleApp, type SingleDetection } from "@/single";
import { resolveBackendEntry, type CliOptions } from "../util.ts";
import { type Check, inline, shellOutput, type Status, versionAtLeast } from "./check.ts";

export interface Environment {
	checks: Check[];
	config?: CrustConfig;
	single?: SingleApp;
}

const PAGE_EXTENSIONS = new Set([".tsx", ".jsx"]);

function isPageFile(value: string | undefined): boolean {
	return value !== undefined && PAGE_EXTENSIONS.has(extname(value).toLowerCase());
}

/** The one top-level `.tsx`/`.jsx` a configless directory holds, if exactly one. */
async function solePageFile(dir: string): Promise<string | undefined> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const pages = entries
		.filter((entry) => entry.isFile() && PAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
		.map((entry) => entry.name);
	return pages.length === 1 ? pages[0] : undefined;
}

/**
 * Decide whether a configless directory is a single-file app.
 *
 * `crust dev app.tsx` takes no config at all, so failing "config" there would be
 * a false alarm. Only a directory with no backend entry and no config is
 * considered, and only one unambiguous page file — an explicit file or
 * `--entry app.tsx` names it when the directory holds more than one.
 */
async function detectConfiglessSingle(options: CliOptions): Promise<SingleDetection | undefined> {
	const backend = await resolveBackendEntry(options.dir, options.entry);
	const hinted = options.single ?? (isPageFile(options.entry) ? options.entry : undefined);
	if (hinted === undefined && backend !== undefined) return undefined;
	const file = hinted ?? (await solePageFile(options.dir));
	if (file === undefined) return undefined;
	return await detectSingle({ single: file, dir: options.dir });
}

export async function checkEnvironment(options: CliOptions): Promise<Environment> {
	const checks: Check[] = [];
	const push = (name: string, status: Status, detail: string): void => {
		checks.push({ name, status, detail });
	};

	// Platform.
	if (process.platform !== "darwin") {
		push("platform", "fail", `macOS only — this is ${process.platform}`);
	} else if (process.arch !== "arm64") {
		push("platform", "fail", `macOS arm64 only — this is ${process.arch}`);
	} else {
		push("platform", "ok", `darwin ${process.arch}`);
	}

	// Runtime.
	push("bun", "ok", `${Bun.version} at ${process.execPath}`);

	// macOS version floor, when the config asks for one.
	const osVersion = await shellOutput(["sw_vers", "-productVersion"]);

	// Config, or the single file that needs none. A config that exists but is
	// broken is always a failure; only a config that is *absent* and a directory
	// with no backend entry is considered a single-file app.
	let config: CrustConfig | undefined;
	let single: SingleApp | undefined;
	let singleProblem: string | undefined;
	try {
		const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
		config = loaded.config;
		push("config", "ok", loaded.path);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		const absent =
			options.config === undefined && (await findConfig(options.dir)) === undefined;
		if (absent) {
			const detected = await detectConfiglessSingle(options);
			if (detected?.kind === "app") {
				single = detected.app;
				push(
					"config",
					"note",
					`none — a single file needs no config: crust dev ${relative(resolve(options.dir), detected.app.file)}`,
				);
			} else if (detected?.kind === "error") {
				singleProblem = detected.message;
			}
		}
		if (!single) {
			push(
				"config",
				"fail",
				`${inline(text)}${singleProblem ? ` (${singleProblem})` : ""} — fix the key named above, run \`crust init\` for a new project, ` +
					"or use single-file mode (`crust dev <file.tsx>`, which needs no config)",
			);
		}
	}

	if (config && osVersion) {
		const minimum = config.build?.minimumSystemVersion;
		if (!minimum) {
			push("macos", "ok", `${osVersion} (no minimumSystemVersion set)`);
		} else {
			push(
				"macos",
				versionAtLeast(osVersion, minimum) ? "ok" : "fail",
				`${osVersion}, build wants ≥ ${minimum}`,
			);
		}
	}

	return { checks, config, single };
}
