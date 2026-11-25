/**
 * The compiled framework cache proof from the dev-binary e2e. A path assertion alone would stop
 * covering the fix: the tree must be private, its marker must be a content hash, and the binary
 * must refuse a source planted inside it on its next launch.
 */
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FRAMEWORK_MARKER, frameworkTreeStamp } from "../../src/cli/framework-stamp.ts";
import { lastLine } from "../lib/text.ts";
import type { Verdict } from "../e2e-harness.ts";
import { bare, NO_BUN_PATH } from "./fixture.ts";

/**
 * Check the materialised tree and return whether it is private enough for the later project-shape
 * proof to symlink. The planted source is restored in `finally`, before that proof starts.
 */
export async function checkFrameworkTree(
	verdict: Verdict,
	tree: string,
	page: string,
	single: string,
): Promise<boolean> {
	const runtime = join(tree, "src", "runtime.ts");
	const info = await stat(tree).catch(() => undefined);
	const isPrivateTree = info?.isDirectory() === true && (info.mode & 0o777) === 0o700;
	verdict.check(
		"framework tree",
		isPrivateTree && (await Bun.file(runtime).exists()),
		isPrivateTree
			? `${tree} is 0700 and holds src/runtime.ts`
			: `${tree} is missing, not a directory, or not 0700`,
	);

	const marker = await Bun.file(join(tree, FRAMEWORK_MARKER))
		.text()
		.catch(() => "");
	const stamped =
		marker.length > 0 && isPrivateTree && marker === (await frameworkTreeStamp(tree));
	verdict.check(
		"framework marker",
		stamped,
		stamped
			? `${FRAMEWORK_MARKER} hashes every cached file`
			: `${FRAMEWORK_MARKER} is absent or does not describe the tree`,
	);

	let refusal: ReturnType<typeof Bun.spawnSync> | undefined;
	if (isPrivateTree) {
		const original = new Uint8Array(await Bun.file(runtime).arrayBuffer());
		try {
			await writeFile(
				runtime,
				"export const startApp = () => { throw new Error('planted') };\n",
			);
			refusal = Bun.spawnSync([...bare(NO_BUN_PATH), "dev", page], {
				cwd: single,
				timeout: 20_000,
			});
		} finally {
			await writeFile(runtime, original);
		}
	}
	const text = refusal
		? `${refusal.stdout?.toString() ?? ""}${refusal.stderr?.toString() ?? ""}`
		: "";
	const refused =
		refusal !== undefined &&
		refusal.exitCode !== 0 &&
		text.includes("does not match the shipped sources");
	verdict.check(
		"planted runtime refused",
		refused,
		refused
			? "binary rejected the planted source instead of importing it"
			: refusal === undefined
				? "no tree to plant"
				: `exit ${String(refusal.exitCode)}: ${lastLine(text) || "no output"}`,
	);
	return isPrivateTree;
}
