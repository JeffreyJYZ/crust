/**
 * The manifest the tarball carries: its name, the `bin` target, and every
 * `exports` entry resolving to a file that actually travelled.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Stage } from "../context.ts";

/** Returns the declared export keys, which the install phase imports in turn. */
export async function checkManifest(stage: Stage): Promise<string[]> {
	const { check, manifest, checkout, pkgRoot, shipped } = stage;

	check(
		"package.json is a parseable manifest named crust",
		manifest.name === checkout.name,
		`name ${JSON.stringify(manifest.name)} is not ${JSON.stringify(checkout.name)}`,
		`name ${manifest.name} version ${manifest.version}`,
	);

	// ---- bin ----------------------------------------------------------
	const bin = (manifest.bin ?? {}) as Record<string, string>;
	const binPath = typeof bin.crust === "string" ? bin.crust.replace(/^\.\//, "") : "";
	check("bin names src/cli/index.ts", binPath === "src/cli/index.ts", `got "${binPath}"`);
	check("bin target travels in the tarball", shipped(binPath), `${binPath} missing`, binPath);

	const binStat =
		binPath.length > 0 ? await stat(join(pkgRoot, binPath)).catch(() => undefined) : undefined;
	const binMode = (binStat?.mode ?? 0) & 0o777;
	check(
		"bin target is executable as a script",
		binStat?.isFile() === true && (binMode & 0o111) !== 0,
		`mode ${binMode.toString(8)} has no execute bit`,
		`mode ${binMode.toString(8)}`,
	);

	const binSource =
		binPath.length > 0 ? await readFile(join(pkgRoot, binPath), "utf8").catch(() => "") : "";
	const binHead = binSource.split("\n")[0] ?? "";
	check(
		"bin target starts with a bun shebang",
		binHead === "#!/usr/bin/env bun",
		`first line ${JSON.stringify(binHead)}`,
	);

	// ---- exports ------------------------------------------------------
	const exportsMap = (manifest.exports ?? {}) as Record<string, string>;
	const declared = Object.keys(exportsMap);
	check(
		"exports declares ., ./plugin and ./vite",
		[".", "./plugin", "./vite"].every((key) => declared.includes(key)),
		declared.join(" "),
	);
	for (const [key, target] of Object.entries(exportsMap)) {
		const path = typeof target === "string" ? target.replace(/^\.\//, "") : "";
		check(
			`exports "${key}" target exists`,
			path.length > 0 && shipped(path),
			`${path || JSON.stringify(target)} missing`,
			path,
		);
	}

	return declared;
}
