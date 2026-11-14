#!/usr/bin/env bun
/**
 * Run `examples/dogear` against this checkout. The example's `crust` dependency points at GitHub, so `crust dev` would run the published framework rather than the tree being edited; a symlink over `node_modules/crust` repoints it.
 * The entry stays under `desktop/` because a root entry is watched recursively, which restarts the backend on every UI save.
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
