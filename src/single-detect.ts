/**
 * Single-file mode's detection half: is this invocation one file, and what config does that imply? A positional is only ever a single file — the extension must be one this framework can bundle, the path must exist, and the directory must hold no `crust.config.ts`/`crust.json`. The config is built in memory, never written, and its one declarable section is `security`, read from the file's `crust-security:` line (see `SECURITY_PRAGMA`).
 */

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { findConfig, type CrustConfig, validateConfig } from "@/config";
import { declaredSecurity } from "./single-pragma.ts";

/** The extensions a single-file positional may carry. */
export const SINGLE_EXTENSIONS: ReadonlySet<string> = new Set([
	".tsx",
	".jsx",
	".ts",
	".js",
	".html",
]);

/** The size of the one window a single file gets. */
export const SINGLE_WINDOW = { width: 900, height: 700 } as const;

/**
 * The one line a single file may use to declare `security`: JSON on one line, in the comment form
 * its own syntax already has (`//` in a module, `<!-- -->` in an `.html` page).
 *
 * It has to be a static literal, not an export. A single-file config is embedded as a literal by
 * both the dev runner and the built wrapper, and detection runs before the page is bundled, so
 * nothing here can evaluate the module — an import, a spread or a computed value would build in dev
 * and vanish from a build. The trade-off is that a JSON typo is a detection failure, and it is:
 * the object is validated by the same `validateConfig` a `crust.config.ts` goes through, so a
 * `microphone` that is not a sentence, or a `script-src` with no `'unsafe-inline'`, is refused here
 * with the same message it would get in a project.
 */
export interface SingleApp {
	/** Absolute path to the one source file. */
	file: string;
	/** The file's directory, which is the project root. */
	dir: string;
	/** App name: the file's basename without its extension. */
	name: string;
	/** The config, built in memory — never written anywhere. */
	config: CrustConfig;
}

export type SingleDetection =
	{ kind: "none" } | { kind: "app"; app: SingleApp } | { kind: "error"; message: string };

/** Whether `path` names a readable file; both halves of the split need it. */
export async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** `my app.tsx` -> `my-app`. An empty result becomes `app`. */
function slug(name: string): string {
	const text = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return text.length === 0 ? "app" : text;
}

/**
 * Decide whether this invocation is a single-file app. A config beside the file means the user has a real project, and guessing which shape they meant is worse than saying so.
 */
export async function detectSingle(options: {
	single?: string;
	dir: string;
	config?: string;
	entry?: string;
}): Promise<SingleDetection> {
	const value = options.single;
	if (value === undefined) return { kind: "none" };
	if (options.config !== undefined) {
		return { kind: "error", message: "a single file and --config cannot be combined" };
	}
	if (options.entry !== undefined) {
		return { kind: "error", message: "a single file and --entry cannot be combined" };
	}

	const file = resolve(options.dir, value);
	if (!(await isFile(file))) {
		return { kind: "error", message: `single-file entry ${value} does not exist (${file})` };
	}
	const extension = extname(file).toLowerCase();
	if (!SINGLE_EXTENSIONS.has(extension)) {
		return {
			kind: "error",
			message: `single-file mode needs a .tsx, .jsx, .ts, .js or .html file, got ${extension || file}`,
		};
	}

	const dir = dirname(file);
	const config = await findConfig(dir);
	if (config !== undefined) {
		return {
			kind: "error",
			message:
				`${basename(file)} sits beside ${basename(config)} — run crust in that project ` +
				`(crust dev --dir ${dir}) instead of single-file mode`,
		};
	}

	const name = basename(file, extension);
	const declared = declaredSecurity(await readFile(file, "utf8"), basename(file));
	if ("error" in declared) return { kind: "error", message: declared.error };
	const built: CrustConfig = {
		app: { id: `crust.single.${slug(name)}`, name, version: "0.0.0" },
		windows: [
			{
				label: "main",
				url: "/",
				width: SINGLE_WINDOW.width,
				height: SINGLE_WINDOW.height,
				title: name,
			},
		],
	};
	if (declared.security !== undefined) {
		built.security = declared.security;
		try {
			// The same validator a `crust.config.ts` goes through, so the single-file path cannot
			// accept a policy or a purpose string the project path refuses.
			validateConfig(built, basename(file));
		} catch (error) {
			return {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}
	return { kind: "app", app: { file, dir, name, config: built } };
}
