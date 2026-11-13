import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CrustConfig, validateConfig } from "./schema.ts";

/** The config filenames crust looks for, in order. */
export const CONFIG_FILES = ["crust.config.ts", "crust.json"] as const;

export interface LoadConfigOptions {
	/** Project directory. Defaults to the current working directory. */
	dir?: string;
	/** Explicit config path, relative to `dir`. */
	configPath?: string;
}

export interface LoadedConfig {
	config: CrustConfig;
	path: string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Load and validate `crust.config.ts` or `crust.json` from a project directory.
 * Every config failure names the file and the offending key.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
	const dir = resolve(options.dir ?? ".");
	const path = options.configPath ? resolve(dir, options.configPath) : await findConfig(dir);

	if (!path) {
		throw new Error(
			`no crust config in ${dir}: expected ${CONFIG_FILES.join(" or ")} in the project root`,
		);
	}
	if (!(await exists(path))) {
		throw new Error(`crust config not found: ${path}`);
	}

	return { config: await readConfig(path), path };
}

/** Find the config file in a directory without loading it. */
export async function findConfig(dir: string): Promise<string | undefined> {
	for (const name of CONFIG_FILES) {
		const candidate = join(dir, name);
		if (await exists(candidate)) return candidate;
	}
	return undefined;
}

async function readConfig(path: string): Promise<CrustConfig> {
	const extension = extname(path);

	if (extension === ".json") {
		let text: string;
		try {
			text = await Bun.file(path).text();
		} catch (error) {
			throw new Error(`could not read ${path}: ${message(error)}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			throw new Error(`could not parse ${path} as JSON: ${message(error)}`);
		}
		return validateConfig(parsed, path);
	}

	if (
		extension === ".ts" ||
		extension === ".mts" ||
		extension === ".js" ||
		extension === ".mjs"
	) {
		const info = await stat(path);
		const specifier = `${pathToFileURL(path).href}?v=${info.mtimeMs}`;
		const module = (await import(specifier)) as { default?: unknown; config?: unknown };
		const value = module.default ?? module.config;
		if (value === undefined) {
			throw new Error(
				`${path} has no default export — expected "export default { app, windows, … }"`,
			);
		}
		return validateConfig(value, path);
	}

	throw new Error(`unsupported crust config ${path}: expected crust.config.ts or crust.json`);
}
