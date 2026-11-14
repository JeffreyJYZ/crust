/**
 * `crust build app.tsx` — the same page bundle `crust dev` serves, embedded in
 * an `.app` instead of served from disk. No icon, no `beforeBuildCommand` and
 * no `app.icon` exist to read, because a single file has no config to name them.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildApp, formatBytes } from "@/packaging/build";
import { signApp } from "@/packaging/sign";
import { buildPage, type PageBuild, type SingleApp } from "@/single";
import { frameworkRoot } from "../framework.ts";
import { fail, line } from "../util.ts";
import { assetsModuleSource, collectAssets } from "./assets.ts";
import { singleWrapperSource } from "./wrapper.ts";

export async function buildSingle(app: SingleApp, minimumSystemVersion: string): Promise<number> {
	console.log(`crust build — ${app.file} (one file, no config)`);

	let page: PageBuild;
	try {
		page = await buildPage(app, { dev: false });
	} catch (error) {
		return fail("build", error instanceof Error ? error.message : String(error));
	}
	line("page", `${join(page.dir, "index.html")} + ${page.entry}`);

	const outDir = resolve(app.dir, "dist");
	await mkdir(outDir, { recursive: true });

	const assets = await collectAssets(page.dir);
	const assetsPath = resolve(outDir, "crust-assets.ts");
	await writeFile(assetsPath, assetsModuleSource(assets), "utf8");
	line(
		"assets",
		`${assets.length} file${assets.length === 1 ? "" : "s"} embedded from the single-file bundle`,
	);

	const wrapperPath = resolve(outDir, "crust-entry.ts");
	await writeFile(
		wrapperPath,
		singleWrapperSource(app, assetsPath, await frameworkRoot()),
		"utf8",
	);

	const result = await buildApp({
		entry: wrapperPath,
		binaryName: "crust-app",
		outDir,
		app: {
			id: app.config.app.id,
			name: app.config.app.name,
			version: app.config.app.version,
			minimumSystemVersion,
		},
	});

	await signApp({ appPath: result.appPath, mode: "adhoc" });

	line("binary", `${formatBytes(result.binaryBytes)}  ${result.binaryPath}`);
	line("app", `${formatBytes(result.assembledBytes)}  ${result.appPath}`);
	line("sign", "ad-hoc (codesign --sign -)");
	line("gatekeeper", "refused on another machine until a Developer ID signature exists");
	console.log(`\ndone — open it locally with: open ${result.appPath}`);
	return 0;
}
