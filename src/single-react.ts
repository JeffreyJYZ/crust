/**
 * The React half of single-file mounting: confirm the project has React 18+,
 * resolve react/react-dom from the project, and fail with a clear build message.
 * `react-dom/client` and `createRoot` exist only in React 18, so an older
 * install is rejected here instead of breaking at runtime.
 */

import { basename, dirname, join, resolve } from "node:path";
import { isFile } from "./single-detect.ts";

/** The leading number of a version, e.g. 18 from "18.3.1-canary". */
function major(version: string): number {
	const match = /^(\d+)/.exec(version);
	return match === null ? 0 : Number(match[1]);
}

/** The installed version of `name` at or above `dir`, or undefined if absent. */
async function installedVersion(name: string, dir: string): Promise<string | undefined> {
	let current = resolve(dir);
	for (;;) {
		const manifest = join(current, "node_modules", name, "package.json");
		if (await isFile(manifest)) {
			try {
				const parsed = JSON.parse(await Bun.file(manifest).text()) as { version?: unknown };
				return typeof parsed.version === "string" ? parsed.version : "";
			} catch {
				return "";
			}
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Fail before `Bun.build` if the mount would need packages the project lacks.
 * Bun's resolver also consults its global install cache, so this is a real
 * `node_modules/<pkg>/package.json` walk — what "installed here" means to a
 * user — and the React 18 floor is checked before the mount uses its API.
 */
export async function requireReact(dir: string, file: string): Promise<void> {
	const react = await installedVersion("react", dir);
	const dom = await installedVersion("react-dom", dir);
	const where = `above ${dir}`;
	if (react === undefined || dom === undefined) {
		throw new Error(
			`${basename(file)} has a default export, so crust mounts it with React 18+, but ` +
				`react and react-dom are not installed ${where} — run "bun add react react-dom" ` +
				"there, or drop the default export and render the page yourself",
		);
	}
	if (major(react) < 18 || major(dom) < 18) {
		throw new Error(
			`${basename(file)} uses react-dom/client and createRoot, which need React 18+, but ` +
				`found react ${react} and react-dom ${dom} ${where} — run "bun add react react-dom" ` +
				"there for React 18 or newer, or drop the default export",
		);
	}
	if (major(react) !== major(dom)) {
		throw new Error(
			`${basename(file)} has mismatched React majors: react ${react}, react-dom ${dom} ` +
				`${where} — install matching versions, e.g. "bun add react@^${major(react)} ` +
				`react-dom@^${major(react)}"`,
		);
	}
}

/** Resolve `react`/`react-dom` from the user's project, not the wrapper's directory. */
export function resolveFromProject(dir: string): Bun.BunPlugin {
	return {
		name: "crust-single-project",
		setup(build) {
			build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => {
				try {
					return { path: Bun.resolveSync(args.path, dir) };
				} catch {
					// A silent fallback lets Bun use a global cache and surface a
					// mismatched-React error at runtime; fail the build with the cause.
					throw new Error(
						`crust could not resolve "${args.path}" from ${dir}. Single-file React ` +
							'mounting needs React 18+ installed there — run "bun add react react-dom".',
					);
				}
			});
		},
	};
}
