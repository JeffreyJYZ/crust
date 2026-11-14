#!/usr/bin/env bun
/**
 * Build crust as one standalone executable and prove it works with no checkout: `bun build --compile --asset` embeds the templates and `src/` tree that `dev` and `build` materialise at runtime, and the checks run the binary from a bare environment and an unrelated directory.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import packageJson from "../package.json";

const root = resolve(import.meta.dir, "..");
const outdir = join(root, "dist");
const outfile = join(outdir, "crust");

/** Everything crust reads from its own package at runtime. */
const ASSETS = ["src", "templates", "tsconfig.json", "package.json"] as const;

/** The bare environment a user's machine has, so nothing leaks in from this one. */
const BARE_ENV = { PATH: "/usr/bin:/bin" };

let failures = 0;

function pass(label: string, detail: string): void {
	console.log(`  PASS  ${label.padEnd(18)}${detail}`);
}

function fail(label: string, detail: string): void {
	failures++;
	console.log(`  FAIL  ${label.padEnd(18)}${detail}`);
}

async function main(): Promise<void> {
	const compile = Bun.spawnSync(
		[
			"bun",
			"build",
			"--compile",
			"--outfile",
			outfile,
			"src/cli/index.ts",
			...ASSETS.map((asset) => `--asset=${asset}`),
		],
		{ cwd: root, stdio: ["inherit", "inherit", "inherit"] },
	);
	if (compile.exitCode !== 0) {
		fail("compile", `bun build --compile exited ${compile.exitCode}`);
		return;
	}

	const { size } = await stat(outfile);
	pass("compile", `${outfile}  ${size.toLocaleString()} bytes`);

	// 1. It starts, and knows its version with no package.json beside it.
	const version = Bun.spawnSync([outfile, "--version"], { env: BARE_ENV });
	if (version.exitCode === 0 && version.stdout.toString().trim() === packageJson.version)
		pass("version", `${version.stdout.toString().trim()} with PATH=/usr/bin:/bin`);
	else
		fail(
			"version",
			`exited ${version.exitCode}, printed ${JSON.stringify(version.stdout.toString().trim())}`,
		);

	// 2. It scaffolds, which means the templates are inside the executable.
	const workspace = await mkdtemp(join(tmpdir(), "crust-standalone-"));
	try {
		for (const [flag, count] of [
			["--next", 7],
			["--react", 6],
			["", 6],
		] as const) {
			const name = `app${flag === "" ? "-plain" : flag}`;
			const target = join(workspace, name);
			const args = [outfile, "init", target, ...(flag === "" ? [] : [flag])];
			const init = Bun.spawnSync(args, { cwd: workspace, env: BARE_ENV });
			// The glob does not see dotfiles, so `.gitignore` is checked separately —
			// it is the file a scaffold is most likely to lose.
			const listed = [...new Bun.Glob("**/*").scanSync({ cwd: target, onlyFiles: true })];
			const ignore = Bun.file(join(target, ".gitignore")).size > 0;
			if (init.exitCode === 0 && listed.length === count && ignore)
				pass("init", `${flag || "(no flag)"} wrote ${listed.length + 1} files`);
			else
				fail(
					"init",
					`${flag || "(no flag)"} exited ${init.exitCode} with ${listed.length} files ` +
						`and .gitignore ${ignore ? "present" : "missing"}: ` +
						init.stderr.toString().trim().slice(0, 120),
				);
		}

		// 3. Doctor reaches the shim, the platform and the templates from inside the
		// binary. It is allowed to fail on the frontend checks — nothing is built yet.
		const scaffold = join(workspace, "app-next");
		const doctor = Bun.spawnSync([outfile, "doctor", "--dir", scaffold], {
			cwd: workspace,
			env: BARE_ENV,
		});
		const text = `${doctor.stdout.toString()}${doctor.stderr.toString()}`;
		for (const check of ["shim", "templates", "window", "platform"]) {
			const line = text.split("\n").find((row) => row.trim().startsWith(check));
			if (line?.includes("[ok]")) pass(`doctor ${check}`, line.trim().slice(0, 80));
			else fail(`doctor ${check}`, line?.trim() ?? "no line printed");
		}
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}

	console.log(
		failures === 0
			? `\nstandalone: PASS  ${outfile}`
			: `\nstandalone: FAIL  ${failures} check(s)`,
	);
	if (failures > 0) process.exit(1);
}

await main();
