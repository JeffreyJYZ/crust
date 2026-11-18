#!/usr/bin/env bun
/**
 * Run `examples/dogear` against this checkout. The example's `crust` dependency points at GitHub, so `crust dev` would run the published framework rather than the tree being edited; a symlink over `node_modules/crust` repoints it.
 * The entry stays under `desktop/` because a root entry is watched recursively, which restarts the backend on every UI save.
 */
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { captureFrontmost, guardFocus, restoreFocus } from "./e2e-harness.ts";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const example = join(repo, "examples", "dogear");
const link = join(example, "node_modules", "crust");

/** Point the example at this tree, then run it until its dev server exits. */
async function main(): Promise<number> {
	const install = Bun.spawnSync(["bun", "install"], {
		cwd: example,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (install.exitCode !== 0) return install.exitCode ?? 1;

	if (existsSync(link)) rmSync(link, { recursive: true, force: true });
	symlinkSync(repo, link, "dir");
	console.log(`  demo      example crust → ${repo}`);

	const dev = Bun.spawn(
		[
			"bun",
			"run",
			join(repo, "src", "cli", "index.ts"),
			"dev",
			"--dir",
			example,
			"--entry",
			"desktop/main.ts",
		],
		{ cwd: repo, stdio: ["inherit", "inherit", "inherit"] },
	);
	return await dev.exited;
}

// Captured before `crust dev` opens its window, so the exit hands focus back to whoever
// was here rather than leaving the example frontmost.
const frontmost = await captureFrontmost();
// Armed at the same point, because the dev server outlives a Ctrl-C: the `finally` below
// never runs on a signal, and the guard is what hands focus back then.
guardFocus();
let code = 1;
try {
	code = await main();
} finally {
	await restoreFocus(frontmost);
}
process.exit(code);
