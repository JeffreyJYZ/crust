/**
 * Extension discovery: every `*.ts` under the project's extension directory becomes a plugin.
 * A broken file is collected, never thrown — one typo must not take a running app down — and two
 * extensions claiming one name are refused together, because a name is a namespace and serving one of
 * two colliding files is the silent shadowing this loader exists to prevent.
 */

import { readdir, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { PluginDefinition } from "../plugins/define.ts";
import { isExtension } from "./define.ts";

/** Where a project keeps its extensions when the config names no directory. */
export const DEFAULT_EXTENSIONS_DIR = "extensions";

export interface ExtensionError {
	/** The file the failure came from, absolute so two same-named files stay distinct. */
	file: string;
	/** What is wrong with it, phrased so the author can act on it. */
	reason: string;
}

export interface LoadExtensionsOptions {
	/** Defaults to `<cwd>/extensions`; `crust` runs with the project as its cwd. */
	dir?: string;
	/** Config entries to load instead of discovering: bare names, project-relative paths, or absolute ones. */
	names?: readonly string[];
}

/** The reason a named file that is not on disk reports, so a caller can phrase it its own way. */
export const NO_SUCH_FILE = "no such file";

export interface LoadedExtensions {
	/** Every file the loader tried, in order — the list `crust build` embeds. */
	files: string[];
	/** The subset that produced a plugin, which is what a dev runtime can import. */
	loaded: string[];
	extensions: PluginDefinition[];
	errors: ExtensionError[];
}

export async function loadExtensions(
	options: LoadExtensionsOptions = {},
): Promise<LoadedExtensions> {
	const files = await resolveExtensionFiles(options);
	const errors: ExtensionError[] = [];
	const outcomes: { file: string; extension: PluginDefinition }[] = [];

	for (const file of files) {
		const loaded = await loadFile(file);
		if ("reason" in loaded) {
			errors.push({ file, reason: loaded.reason });
			continue;
		}
		outcomes.push({ file, extension: loaded });
	}

	// A name is a namespace, so a collision refuses every file that claims it: keeping the first is the
	// silent shadowing the module doc promises this loader prevents. Order is preserved, so the
	// extensions that do load stay in filename order.
	const claims = new Map<string, string[]>();
	for (const { file, extension } of outcomes) {
		claims.set(extension.name, [...(claims.get(extension.name) ?? []), file]);
	}

	const extensions: PluginDefinition[] = [];
	const loaded: string[] = [];
	for (const { file, extension } of outcomes) {
		const owners = claims.get(extension.name) ?? [];
		if (owners.length > 1) {
			const others = owners.filter((other) => other !== file);
			errors.push({
				file,
				reason:
					`duplicate extension name "${extension.name}" — ` +
					`${others.join(", ")} declares it too`,
			});
			continue;
		}
		extensions.push(extension);
		loaded.push(file);
	}

	return { files, loaded, extensions, errors };
}

/** The files the loader would import: discovery order, or the config's list in the order given. */
export async function resolveExtensionFiles(
	options: LoadExtensionsOptions = {},
): Promise<string[]> {
	const dir = resolve(options.dir ?? join(process.cwd(), DEFAULT_EXTENSIONS_DIR));
	return options.names === undefined ? await discover(dir) : named(dir, options.names);
}

/** Filename order, not directory order, so two machines load the same table. */
async function discover(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && isExtensionFile(entry.name))
			.map((entry) => entry.name)
			.sort()
			.map((name) => join(dir, name));
	} catch {
		return [];
	}
}

function isExtensionFile(name: string): boolean {
	return name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts");
}

/**
 * A config entry resolves against the project, so `clock.ts` and `extensions/clock.ts` both land;
 * a bare name gets its `.ts` back, since that is the only kind of file this loader runs.
 */
function named(dir: string, names: readonly string[]): string[] {
	return names.map((name) => {
		if (isAbsolute(name)) return name;
		const path = name.includes("/") ? resolve(dir, "..", name) : join(dir, name);
		return extname(path) === "" ? `${path}.ts` : path;
	});
}

async function loadFile(file: string): Promise<PluginDefinition | { reason: string }> {
	try {
		if (!(await stat(file)).isFile()) return { reason: "not a file" };
	} catch {
		return { reason: NO_SUCH_FILE };
	}

	try {
		const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
		const value = module.default;
		if (value === undefined) {
			return {
				reason: "no default export — write `export default defineExtension({ ... })`",
			};
		}
		if (!isExtension(value)) {
			return { reason: "default export is not an extension — build it with defineExtension" };
		}
		return value;
	} catch (error) {
		return { reason: error instanceof Error ? error.message : String(error) };
	}
}
