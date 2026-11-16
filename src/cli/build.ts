/**
 * `crust build` — compile the backend with Bun, assemble `X.app`, then ad-hoc sign it; a Developer ID signature is `crust sign`'s job. The two sizes print separately because they answer different questions: the compiled binary is what Bun produced, the assembled bundle is what a recipient's disk gives up.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "@/config";
import { DEFAULT_EXTENSIONS_DIR, resolveExtensionFiles } from "@/extensions/load.ts";
import { buildApp, formatBytes } from "@/packaging/build";
import { signApp } from "@/packaging/sign";
import { detectSingle } from "../single.ts";
import { assetsModuleSource } from "./build/assets.ts";
import { resolveAssets } from "./build/resolve-assets.ts";
import { buildSingle } from "./build/single-app.ts";
import { wrapperSource } from "./build/wrapper.ts";
import { projectCrustRoot } from "./framework.ts";
import {
	exists,
	fail,
	line,
	missingInstall,
	resolveBackendEntry,
	type CliOptions,
} from "./util.ts";

export { assetsModuleSource, type AssetFile } from "./build/assets.ts";
export { resolveAssets, type ResolvedAssets } from "./build/resolve-assets.ts";

/** LSMinimumSystemVersion when the config does not name one. */
const DEFAULT_MINIMUM_SYSTEM_VERSION = "13.0";

export async function build(options: CliOptions): Promise<number> {
	const detected = await detectSingle(options);
	if (detected.kind === "error") return fail("build", detected.message);
	if (detected.kind === "app") return buildSingle(detected.app, DEFAULT_MINIMUM_SYSTEM_VERSION);

	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust build — ${loaded.path}`);
	const config = loaded.config;

	// A missing install is the state a clone or a clean leaves behind, and it has to be
	// said plainly: otherwise the frontend command resolves its tool from a global cache
	// and fails deep inside its own bundler, which reads as crust's fault.
	const needsInstall = await missingInstall(options.dir);
	if (needsInstall) return fail("build", needsInstall);

	const backend = await resolveBackendEntry(options.dir, options.entry);
	if (!backend) {
		return fail(
			"build",
			options.entry
				? `backend entry ${options.entry} does not exist under ${options.dir}`
				: `no backend entry in ${options.dir} — expected src/main.ts or main.ts`,
		);
	}
	const entry = backend.path;

	let iconPath: string | undefined;
	if (config.app.icon) {
		iconPath = resolve(options.dir, config.app.icon);
		if (!(await exists(iconPath))) {
			return fail(
				"build",
				`app.icon ${config.app.icon} does not exist (resolved to ${iconPath})`,
			);
		}
	}

	const minimumSystemVersion =
		config.build?.minimumSystemVersion ?? DEFAULT_MINIMUM_SYSTEM_VERSION;

	const outDir = resolve(options.dir, "dist");
	// beforeBuildCommand runs inside here, before the directory is read: a
	// failed frontend build stops the command rather than packaging stale bytes.
	const resolved = await resolveAssets(options.dir, config, outDir);
	if (!resolved.ok) return fail("build", resolved.failure);
	const assetsLabel = resolved.label;

	await mkdir(outDir, { recursive: true });

	const assets = resolved.files;
	const assetsPath = resolve(outDir, "crust-assets.ts");
	await writeFile(assetsPath, assetsModuleSource(assets), "utf8");
	line(
		"assets",
		assets.length > 0
			? `${assets.length} file${assets.length === 1 ? "" : "s"} from ${assetsLabel}/`
			: `none — ${assetsLabel}/ is empty or missing`,
	);

	// An extension is an import inside the binary, so a file the config names must be there now:
	// a build that skipped it would ship an app whose commands answer `unknown-plugin`.
	const extensionFiles = await resolveExtensionFiles({
		dir: join(options.dir, DEFAULT_EXTENSIONS_DIR),
		names: config.extensions,
	});
	for (const file of extensionFiles) {
		if (!(await exists(file))) {
			return fail("build", `extensions entry ${file} does not exist`);
		}
	}
	if (extensionFiles.length > 0) {
		line(
			"extensions",
			`${extensionFiles.length} file${extensionFiles.length === 1 ? "" : "s"} embedded`,
		);
	}

	const crustRoot = await projectCrustRoot(options.dir);
	const wrapperPath = resolve(outDir, "crust-entry.ts");
	await writeFile(
		wrapperPath,
		wrapperSource({
			configPath: resolve(options.dir, loaded.path),
			entryPath: entry,
			assetsPath,
			runtimePath: resolve(crustRoot, "src/runtime.ts"),
			extensionsPath: resolve(crustRoot, "src/extensions/registry.ts"),
			projectDir: options.dir,
			extensionFiles,
		}),
		"utf8",
	);

	const result = await buildApp({
		entry: wrapperPath,
		binaryName: "crust-app",
		outDir,
		app: {
			id: config.app.id,
			name: config.app.name,
			version: config.app.version,
			// `Resources/icon.icns` is converted through `sips` and `iconutil`, which ship
			// only on macOS; a Linux or Windows host carries the PNG into its own artefact.
			iconPath: process.platform === "darwin" ? iconPath : undefined,
			minimumSystemVersion,
			urlScheme: config.build?.urlScheme,
		},
	});

	// `codesign` is macOS-only, and the `.app` is not what Linux or Windows ship: those
	// hosts assemble the same bundle around the same binary and sign nothing.
	const signed = process.platform === "darwin";
	if (signed) await signApp({ appPath: result.appPath, mode: "adhoc" });

	line("binary", `${formatBytes(result.binaryBytes)}  ${result.binaryPath}`);
	line("app", `${formatBytes(result.assembledBytes)}  ${result.appPath}`);
	line("sign", signed ? "ad-hoc (codesign --sign -)" : "none — codesign is macOS-only");
	if (signed) {
		line("gatekeeper", "refused on another machine until a Developer ID signature exists");
	}
	console.log(`\ndone — open it locally with: open ${result.appPath}`);
	return 0;
}
