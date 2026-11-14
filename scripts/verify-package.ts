/**
 * Assert what `bun add crust` delivers, from the tarball alone: every other check reads the working tree, so all of them pass on a package that `files`, `bin` or `exports` breaks the moment it is installed.
 * Phases: pack, read the received copy, then `bun add <tarball>` into an empty project and run the real `crust --help` and `crust init probe --react`. `--help` imports every CLI module, so a specifier resolving only in this checkout fails here. Code in `verify-package/`.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBytes } from "../src/packaging/build.ts";
import { run } from "../src/packaging/exec.ts";
import { type Check, type Gap, ROOT, type Stage, filesUnder } from "./verify-package/context.ts";
import { checkInstall } from "./verify-package/phases/install.ts";
import { checkManifest } from "./verify-package/phases/manifest.ts";
import { checkTravel } from "./verify-package/phases/travel.ts";

async function main(): Promise<number> {
	const keep = process.argv.includes("--keep");
	const gaps: Gap[] = [];
	let checks = 0;

	const check: Check = (what, ok, gap = "", found = "") => {
		checks++;
		if (ok) {
			console.log(`  PASS  ${what}${found.length > 0 ? `  ${found}` : ""}`);
			return;
		}
		gaps.push({ what, detail: gap });
		console.log(`  FAIL  ${what}${gap.length > 0 ? `  ${gap}` : ""}`);
	};

	const workspace = await mkdtemp(join(tmpdir(), "crust-verify-package-"));
	try {
		// ---- pack ---------------------------------------------------------
		const packDir = join(workspace, "pack");
		await mkdir(packDir, { recursive: true });
		const packed = await run(["bun", "pm", "pack", "--destination", packDir, "--quiet"], {
			cwd: ROOT,
		});
		if (packed.code !== 0) {
			console.log(`verify-package: FAIL  bun pm pack exited ${packed.code}`);
			console.log(`  ${(packed.stderr.trim() || packed.stdout.trim()).split("\n")[0]}`);
			return 1;
		}
		const tarball = packed.stdout.trim().split("\n").pop() ?? "";
		const tarballStat = await stat(tarball).catch(() => undefined);
		if (!tarballStat?.isFile()) {
			console.log(`verify-package: FAIL  bun pm pack printed no tarball (${tarball})`);
			return 1;
		}
		console.log(`  pack  ${tarball}  ${formatBytes(tarballStat.size)}`);

		// ---- unpack -------------------------------------------------------
		const unpackDir = join(workspace, "unpacked");
		await mkdir(unpackDir, { recursive: true });
		const extracted = await run(["tar", "-xzf", tarball, "-C", unpackDir]);
		if (extracted.code !== 0) {
			console.log(`verify-package: FAIL  tar -xzf exited ${extracted.code}`);
			console.log(`  ${extracted.stderr.trim().split("\n")[0]}`);
			return 1;
		}
		const pkgRoot = join(unpackDir, "package");

		// The listing is the whole truth about what travelled: every assertion
		// below reads this set (or a file under `pkgRoot`), never the checkout.
		const listing = new Set(await filesUnder(pkgRoot));
		const manifestRaw = await readFile(join(pkgRoot, "package.json"), "utf8").catch(() => "");
		let manifest: Record<string, unknown> = {};
		try {
			manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
		} catch {
			// Reported below as the first missing fact; every later assertion on
			// the manifest would only repeat it.
		}
		const checkout = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as Record<
			string,
			unknown
		>;

		const stage: Stage = {
			check,
			pkgRoot,
			listing,
			shipped: (path) => listing.has(path),
			manifest,
			checkout,
		};
		const declared = await checkManifest(stage);
		await checkTravel(stage);
		await checkInstall(stage, workspace, tarball, declared);

		// ---- verdict ------------------------------------------------------
		const verdict = gaps.length === 0 ? "PASS" : "FAIL";
		const summary =
			gaps.length === 0 ? `${checks} check(s)` : `${gaps.length} of ${checks} check(s)`;
		console.log(
			`verify-package: ${verdict}  ${summary}  tarball ${formatBytes(tarballStat.size)}`,
		);
		if (keep) console.log(`  kept  ${workspace}`);
		return gaps.length === 0 ? 0 : 1;
	} finally {
		if (!keep) await rm(workspace, { recursive: true, force: true });
	}
}

try {
	process.exit(await main());
} catch (error) {
	// An unreadable tarball is still a verdict, not a stack trace.
	console.log(`verify-package: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
