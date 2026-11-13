/**
 * One file as a crust app — `crust dev app.tsx` and `crust build app.tsx`.
 *
 * A single-file app has no `crust.config.ts` and no `main.ts`. This module
 * detects that shape, builds the config in memory, and bundles the page with
 * `Bun.build`; `dev.ts` owns the window/reload loop and `build.ts` owns the
 * `.app`. Nothing here writes into the project except the bundle directory
 * (`<dir>/.crust/single` in dev, `<dir>/dist/single` in a build).
 *
 * The page convention, stated once because it is the whole contract:
 *
 *   - a file whose source contains `export default` is a React component; crust
 *     mounts it into `#root` with `react-dom/client`, resolved from the file's
 *     own `node_modules`;
 *   - any other file is loaded for its own side effects and is expected to
 *     render itself.
 *
 * The backend is the framework, not the file: `app` answers `info` and `echo`,
 * so `window.crust.invoke("info")` proves the round trip with no second file.
 * `docs/single-file.md` is the user-facing version of all of this.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { findConfig, type CrustConfig } from "@/config";
import type { App } from "./app.ts";

/** The package root; this module lives in `src/`. */
const PACKAGE_ROOT = resolve(import.meta.dir, "..");

/** The extensions a single-file positional may carry. */
export const SINGLE_EXTENSIONS: ReadonlySet<string> = new Set([".tsx", ".jsx", ".ts", ".js"]);

/** The page module's name inside the bundle directory. */
const PAGE_ENTRY = "page.js";

/**
 * The dev reload marker. The page polls it and reloads when it changes; the
 * `.txt` matters, because the bridge treats an extensionless miss as a
 * client-side route and would answer the document instead of a 404.
 */
const RELOAD_FILE = "__crust_reload.txt";

/** The size of the one window a single file gets. */
export const SINGLE_WINDOW = { width: 900, height: 700 } as const;

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

/** A bundle ready for the bridge to serve. */
export interface PageBuild {
	/** Directory holding `index.html` and the JS module. */
	dir: string;
	/** The module's filename inside `dir`. */
	entry: string;
}

async function isFile(path: string): Promise<boolean> {
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
 * Decide whether this invocation is a single-file app.
 *
 * A positional is only ever a single file: the extension must be one this
 * module can bundle, the path must exist, and the directory must hold no
 * `crust.config.ts`/`crust.json`. A config beside the file means the user has a
 * real project, and guessing which shape they meant is worse than saying so.
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
			message: `single-file mode needs a .tsx, .jsx, .ts or .js file, got ${extension || file}`,
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
	return {
		kind: "app",
		app: {
			file,
			dir,
			name,
			config: {
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
			},
		},
	};
}

/**
 * Textual, and documented as such: `export default` anywhere at the start of a
 * line, or an alias export of `default`. A `.tsx` file that renders itself and
 * has no default export is loaded as-is, which is how React stays optional.
 */
export function hasDefaultExport(source: string): boolean {
	return (
		/^\s*export\s+default\b/m.test(source) ||
		/\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source)
	);
}

/** Whether a package is physically installed at or above `dir`. */
async function installed(name: string, dir: string): Promise<boolean> {
	let current = resolve(dir);
	for (;;) {
		if (await isFile(join(current, "node_modules", name, "package.json"))) return true;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

/**
 * Fail before `Bun.build` if the mount would need packages the project does not
 * have. Bun's own resolver also consults its global install cache, and a
 * half-populated cache resolves `react` while failing on `react-dom`'s own
 * dependency — so the check is a real `node_modules/<pkg>/package.json` walk,
 * which is what "installed here" means to a user.
 */
async function requireReact(dir: string, file: string): Promise<void> {
	if ((await installed("react", dir)) && (await installed("react-dom", dir))) return;
	throw new Error(
		`${basename(file)} has a default export, so crust mounts it with React, but react and ` +
			`react-dom are not installed above ${dir} — run "bun add react react-dom" there, or ` +
			"drop the default export and render the page yourself",
	);
}

/** Resolve `react`/`react-dom` from the user's project, not from the wrapper's directory. */
function resolveFromProject(dir: string): Bun.BunPlugin {
	return {
		name: "crust-single-project",
		setup(build) {
			build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => {
				try {
					return { path: Bun.resolveSync(args.path, dir) };
				} catch {
					return undefined;
				}
			});
		},
	};
}

/** The generated module that mounts a default-exported React component. */
function mountSource(app: SingleApp): string {
	return [
		"// Generated by crust from a single file. Edit nothing here.",
		`import * as entry from ${JSON.stringify(app.file)};`,
		"const Component = (entry as { default?: unknown }).default;",
		'const mount = document.getElementById("root");',
		'if (mount === null) throw new Error("crust: the single-file page has no #root");',
		'if (typeof Component !== "function") {',
		'\tthrow new Error("crust: the default export is not a React component");',
		"}",
		"const [{ createElement }, { createRoot }] = await Promise.all([",
		'\timport("react"),',
		'\timport("react-dom/client"),',
		"]);",
		"createRoot(mount).render(createElement(Component as never));",
		"",
	].join("\n");
}

/** The HTML document: `#root` for the mount, the module, and the dev poller. */
function documentSource(app: SingleApp, entry: string, dev: boolean): string {
	const title = app.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
	// Full reload only. The bridge serves every asset with `cache-control:
	// no-store`, so `location.reload()` re-reads the freshly written module.
	const reload = dev
		? [
				"<script>(function () {",
				'\tvar marker = "";',
				"\tfunction tick() {",
				`\t\tfetch("/${RELOAD_FILE}", { cache: "no-store" })`,
				"\t\t\t.then(function (response) { return response.ok ? response.text() : null; })",
				"\t\t\t.then(function (next) {",
				"\t\t\t\tif (next === null) return;",
				'\t\t\t\tif (marker === "") { marker = next; return; }',
				"\t\t\t\tif (next !== marker) location.reload();",
				"\t\t\t})",
				"\t\t\t.catch(function () {});",
				"\t}",
				"\tsetInterval(tick, 400);",
				"\ttick();",
				"})();</script>",
			].join("\n")
		: "";
	return [
		"<!doctype html>",
		"<html>",
		"<head>",
		'\t<meta charset="utf-8" />',
		`\t<title>${title}</title>`,
		"</head>",
		"<body>",
		'\t<div id="root"></div>',
		`\t<script type="module" src="./${entry}"></script>`,
		reload === "" ? "" : reload,
		"</body>",
		"</html>",
	].join("\n");
}

interface BuildLog {
	message: string;
	position?: { file?: string; line?: number; column?: number } | null;
}

/**
 * `Bun.build` reports a syntax error by *throwing* an `AggregateError` whose
 * `errors` are the same `BuildMessage` objects a `success: false` result
 * carries. Both shapes are formatted here, so a rebuild failure always names a
 * file, a position and the compiler's own sentence rather than "Bundle failed".
 */
function bundleFailure(logs: readonly BuildLog[], reason: string): Error {
	const rows = logs.map((log) => {
		const at = log.position;
		const where =
			at?.file === undefined ? "" : `${at.file}:${at.line ?? 0}:${at.column ?? 0}  `;
		return `${where}${log.message}`;
	});
	return new Error(rows.length > 0 ? rows.join("\n") : reason);
}

/**
 * Bundle the page and write the document beside it.
 *
 * A failed build throws before touching `index.html` or the reload marker, so
 * the previously written page stays exactly where it was and a running window
 * keeps it.
 */
export async function buildPage(app: SingleApp, options: { dev: boolean }): Promise<PageBuild> {
	const outDir = options.dev
		? join(app.dir, ".crust", "single")
		: join(app.dir, "dist", "single");
	await mkdir(outDir, { recursive: true });

	const source = await Bun.file(app.file).text();
	const react = hasDefaultExport(source);
	if (react) await requireReact(app.dir, app.file);

	let entrypoint = app.file;
	if (react) {
		// One level above the served directory: the wrapper is build input, not
		// part of the page, so the asset walk must never see it.
		const wrapperPath = join(dirname(outDir), "crust-single-entry.ts");
		await writeFile(wrapperPath, mountSource(app), "utf8");
		entrypoint = wrapperPath;
	}

	let result: Awaited<ReturnType<typeof Bun.build>>;
	try {
		result = await Bun.build({
			entrypoints: [entrypoint],
			outdir: outDir,
			target: "browser",
			format: "esm",
			splitting: false,
			minify: false,
			sourcemap: options.dev ? "inline" : "none",
			naming: PAGE_ENTRY,
			plugins: [resolveFromProject(app.dir)],
		});
	} catch (error) {
		// A syntax error throws; a resolution error returns `success: false`.
		const reason = error instanceof Error ? error.message : String(error);
		const logs = error instanceof AggregateError ? (error.errors as BuildLog[]) : [];
		throw bundleFailure(logs, reason);
	}
	if (!result.success)
		throw bundleFailure(result.logs as BuildLog[], "the bundle produced no output");

	await writeFile(
		join(outDir, "index.html"),
		`${documentSource(app, PAGE_ENTRY, options.dev)}\n`,
		"utf8",
	);
	if (options.dev) {
		await writeFile(join(outDir, RELOAD_FILE), `${Date.now()}\n`, "utf8");
	}
	return { dir: outDir, entry: PAGE_ENTRY };
}

/**
 * The commands a single file gets from the framework, because there is no
 * backend module to register its own. `info` is the round-trip proof; `echo`
 * proves the payload arrives unchanged.
 */
export function registerSingleCommands(app: App, info: { file: string; name: string }): void {
	app.command("info", () => {
		const answer = { app: info.name, file: info.file, single: true };
		console.log(`  info      ${info.name} answered the page`);
		return answer;
	});
	app.command("echo", (args) => {
		console.log(`  echo      ${JSON.stringify(args)}`);
		return args;
	});
}

/**
 * The dev runtime script, written into a temp directory and spawned as the app
 * process. The config travels as a literal, so no `crust.config.ts` exists on
 * disk for anything to find.
 */
export function devRunnerSource(app: SingleApp, pageDir: string): string {
	return [
		"// Generated by `crust dev` for a single file. Edit nothing here.",
		`import { app } from ${JSON.stringify(join(PACKAGE_ROOT, "src/index.ts"))};`,
		`import { startApp } from ${JSON.stringify(join(PACKAGE_ROOT, "src/runtime.ts"))};`,
		`import { registerSingleCommands } from ${JSON.stringify(join(PACKAGE_ROOT, "src/single.ts"))};`,
		"",
		`registerSingleCommands(app, ${JSON.stringify({ file: app.file, name: app.name })});`,
		'app.on("window-all-closed", () => { app.quit(); });',
		"await startApp({",
		`\tconfig: ${JSON.stringify(app.config, null, "\t")},`,
		`\troot: ${JSON.stringify(pageDir)},`,
		"\tentryModule: async () => {",
		"\t\tawait app.run();",
		"\t},",
		"});",
		"",
	].join("\n");
}
