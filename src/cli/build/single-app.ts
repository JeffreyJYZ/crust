/**
 * `crust build app.tsx` — the same page bundle `crust dev` serves, embedded in
 * an `.app` instead of served from disk. No icon, no `beforeBuildCommand` and
 * no `app.icon` exist to read, because a single file has no config to name them.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildApp, formatBytes } from "@/packaging/build";
import { signSidecars } from "@/packaging/installers-sidecars";
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
	line(
		"page",
		page.entry === "index.html"
			? join(page.dir, "index.html")
			: `${join(page.dir, "index.html")} + ${page.entry}`,
	);

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
		// The same wiring `crust build` uses: a single-file config is built in memory, so
		// today there are no declared sidecars, but the manifest must still name the set
		// that was shipped instead of silently writing `[]` if one is ever declared.
		sidecars: app.config.build?.sidecars,
		projectDir: app.dir,
		app: {
			id: app.config.app.id,
			name: app.config.app.name,
			version: app.config.app.version,
			minimumSystemVersion,
		},
	});

	const assembled = result.assembled;
	if (assembled) {
		await signSidecars(assembled.executablePath, app.config.build?.sidecars ?? []);
		await signApp({ appPath: assembled.appPath, mode: "adhoc" });
	}

	line("binary", `${formatBytes(result.binaryBytes)}  ${result.binaryPath}`);
	if (assembled) {
		line("app", `${formatBytes(assembled.assembledBytes)}  ${assembled.appPath}`);
		line("sign", "ad-hoc (codesign --sign -)");
		line("gatekeeper", "refused on another machine until a Developer ID signature exists");
		console.log(`\ndone — open it locally with: open ${assembled.appPath}`);
	} else {
		line("sign", "none — codesign is macOS-only");
		console.log(`\ndone — run it locally with: ${result.binaryPath}`);
	}
	return 0;
}
