/**
 * Single-file mode's bundle step: one `Bun.build`, the document beside it, and the reload marker a dev page polls. Only the bundle directory is written — `<dir>/.crust/single` in dev, `<dir>/dist/single` in a build.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { DEFAULT_EXTENSIONS_DIR, resolveExtensionFiles } from "@/extensions/load.ts";
import type { SingleApp } from "./single-detect.ts";
import {
	documentSource,
	hasDefaultExport,
	mountSource,
	PAGE_ENTRY,
	type PageBuild,
	RELOAD_FILE,
	requireReact,
	resolveFromProject,
} from "./single-page.ts";

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
 * Single-file mode cannot carry an extension, so it says so instead of dropping one. There is no
 * `crust.config.ts` beside the file to name any (single detection refuses that shape), which leaves
 * discovery as the only source — and the generated single-file wrapper (`src/cli/build/wrapper.ts`,
 * shared with `crust build app.tsx`) has no slot to register them.
 * Refusing is the cheaper honest option: embedding would need a second generator for `crust dev
 * app.tsx` alone, which is exactly the dev/prod divergence this refusal exists to prevent. Both
 * halves call this, so they agree on the reason too.
 */
async function refuseExtensions(app: SingleApp): Promise<void> {
	const files = await resolveExtensionFiles({ dir: join(app.dir, DEFAULT_EXTENSIONS_DIR) });
	if (files.length === 0) return;
	throw new Error(
		`single-file mode carries no extensions, but ${files[0]} was found. A single file embeds one ` +
			"page and no extension registry — move the extension into a project with a " +
			"crust.config.ts (extensions: [...]) and run `crust dev --dir <project>` instead",
	);
}

/**
 * `Bun.build` does not clean its outdir, and an `.html` entry skips the bundler entirely. Remove
 * anything the current build did not just write, so an old `page.js` cannot travel into the binary
 * after the source switched to plain HTML. Called only after a successful write, so a failed build
 * still leaves the last good page in place.
 */
async function removeStale(dir: string, keep: readonly string[]): Promise<void> {
	const wanted = new Set(keep);
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (wanted.has(entry.name)) continue;
		await rm(join(dir, entry.name), { recursive: true, force: true });
	}
}

/**
 * Bundle the page and write the document beside it. A failed build throws before touching `index.html` or the reload marker, so the previously written page stays where it was and a running window keeps it.
 */
export async function buildPage(app: SingleApp, options: { dev: boolean }): Promise<PageBuild> {
	await refuseExtensions(app);

	const outDir = options.dev
		? join(app.dir, ".crust", "single")
		: join(app.dir, "dist", "single");
	await mkdir(outDir, { recursive: true });

	// An `.html` entry is the document, not a module: copy it verbatim so the
	// page keeps its own markup, and skip the bundler entirely.
	if (extname(app.file).toLowerCase() === ".html") {
		await writeFile(join(outDir, "index.html"), await Bun.file(app.file).text(), "utf8");
		const keep = ["index.html"];
		if (options.dev) {
			await writeFile(join(outDir, RELOAD_FILE), `${Date.now()}\n`, "utf8");
			keep.push(RELOAD_FILE);
		}
		await removeStale(outDir, keep);
		return { dir: outDir, entry: "index.html" };
	}

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
	const keep = ["index.html", PAGE_ENTRY];
	if (options.dev) {
		await writeFile(join(outDir, RELOAD_FILE), `${Date.now()}\n`, "utf8");
		keep.push(RELOAD_FILE);
	}
	await removeStale(outDir, keep);
	return { dir: outDir, entry: PAGE_ENTRY };
}
