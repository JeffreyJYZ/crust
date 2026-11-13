import { tmpdir } from "node:os";
import { join } from "node:path";

import { listAssets, readAsset } from "./assets.ts";
import { crustRoot, exists, VERSION } from "./util.ts";

let cached: string | undefined;

/**
 * True when this code is running inside a compiled executable rather than a checkout.
 *
 * The embedded tree is mounted at `/$bunfs`, and this process can read it — but a child
 * `bun build` cannot, so `dev` and `build` must never hand that path to one. `exists()`
 * is therefore not the test: it says yes inside a binary and then the child fails with
 * `Could not resolve: "/$bunfs/root/src/runtime.ts"`.
 */
function inExecutable(): boolean {
	return import.meta.dir.includes("/$bunfs");
}

/**
 * A real directory holding crust's own sources, for the code `dev` and `build` generate.
 *
 * In a checkout that is the checkout. In a compiled executable there is no checkout, so
 * the embedded tree is written to a temporary directory once and the generated entry
 * imports from there.
 *
 * The directory is keyed by version, and the marker is written last, so a half-written
 * tree from an interrupted run is rebuilt instead of trusted.
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
