/**
 * Single-file mode's bundle step: one `Bun.build`, the document beside it, and
 * the reload marker a dev page polls.
 *
 * A failed build throws before touching `index.html` or the marker, so the
 * previously written page stays exactly where it was and a running window keeps
 * it. Only the bundle directory is written: `<dir>/.crust/single` in dev,
 * `<dir>/dist/single` in a build.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
