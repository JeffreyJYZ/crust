#!/usr/bin/env bun
/**
 * Run `examples/dogear` against this checkout.
 *
 * Two things make the plain command wrong. The example's `crust` dependency points at
 * GitHub, so `crust dev` would run the *published* framework rather than the tree you are
 * editing — the runtime a dev session spawns is the project's copy. And the example ships
 * no `node_modules`, because the e2e builds a scratch copy instead.
 *
 * So: install, repoint the dependency at this checkout for the run, and start dev with the
 * entry the example keeps under `desktop/` (a root entry is watched recursively, which
 * restarts the backend on every UI save).
 */
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const repo = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const example = join(repo, "examples", "dogear");
const link = join(example, "node_modules", "crust");

const install = Bun.spawnSync(["bun", "install"], {
	cwd: example,
	stdio: ["inherit", "inherit", "inherit"],
});
if (install.exitCode !== 0) process.exit(install.exitCode ?? 1);

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
process.exit(await dev.exited);
