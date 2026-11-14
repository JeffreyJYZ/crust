import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listAssets, readAsset } from "./assets.ts";
import { crustRoot, exists, VERSION } from "./util.ts";

let cached: string | undefined;

/**
 * True when this code runs inside a compiled executable rather than a checkout. The embedded tree is mounted at `/$bunfs` and this process can read it, but a child `bun build` cannot — so `exists()` is not the test: it says yes inside a binary and the child then fails with `Could not resolve: "/$bunfs/root/src/runtime.ts"`.
 */
function inExecutable(): boolean {
	return import.meta.dir.includes("/$bunfs");
}

/** True when runtime paths live inside a compiled executable rather than a checkout. */
export { inExecutable };

/**
 * The crust package the project itself depends on, when it has one. Everything the project runs must come from the same module instance its `import "crust"` resolves to, or two copies exist — the CLI's and the project's — each with its own `app` singleton: `app.run()` in a built entry never sees the wrapper's config, and under `crust dev` a command registered by `main.ts` is invisible to the runtime, which answers `crust: unknown command "greet"`.
 * A checkout hides this because `link:` makes both specifiers one realpath; an installed crust exposes it, which is why this resolves by realpath rather than by string.
 */
export async function projectCrustRoot(dir: string): Promise<string> {
	const candidate = join(dir, "node_modules", "crust");
	try {
		const manifest = (await Bun.file(join(candidate, "package.json")).json()) as {
			name?: unknown;
		};
		if (manifest.name === "crust" && (await exists(join(candidate, "src", "runtime.ts"))))
			return await realpath(candidate);
	} catch {
		// No usable dependency: fall back to the framework this CLI carries.
	}
	return await frameworkRoot();
}

/**
 * A real directory holding crust's own sources, for the code `dev` and `build` generate. In a checkout that is the checkout; in a compiled executable the embedded tree is written to a temporary directory once and the generated entry imports from there.
 * The directory is keyed by version and the marker is written last, so a half-written tree from an interrupted run is rebuilt instead of trusted.
 */
export async function frameworkRoot(): Promise<string> {
	if (!inExecutable() && (await exists(join(crustRoot, "src", "runtime.ts")))) return crustRoot;
	if (cached !== undefined) return cached;

	const target = join(tmpdir(), `crust-framework-${VERSION}`);
	const marker = join(target, ".complete");
	if (await exists(marker)) {
		cached = target;
		return target;
	}

	const assets = await listAssets("src");
	if (assets.length === 0)
		throw new Error(
			"this crust build carries no framework sources — it was compiled without --asset=src, " +
				"so dev and build cannot generate an entry",
		);
	for (const asset of assets) {
		await Bun.write(join(target, "src", asset.relative), await asset.bytes());
	}
	// The generated tree imports through the `@/` alias, so the config that defines
	// it travels with it, and package.json keeps the version readable from there.
	for (const name of ["tsconfig.json", "package.json"]) {
		const bytes = await readAsset(name);
		if (bytes) await Bun.write(join(target, name), bytes);
	}
	await Bun.write(marker, "");
	cached = target;
	return target;
}
