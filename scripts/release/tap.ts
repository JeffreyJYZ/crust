/**
 * The tap half of a release: bump the formula with this tag's three digests and open the
 * one PR. Kept apart from `release.ts` so the orchestration stays visible on one screen.
 */
import { bumpFormula, tapPrBody } from "./formula.ts";
import { gitEnv, sh, TAP_DIR, TAP_REMOTE } from "./git.ts";
import type { LinuxDigests } from "./linux-assets.ts";

export async function openTapPr(
	version: string,
	sha: string,
	linux: LinuxDigests,
): Promise<string> {
	const formula = `${TAP_DIR}/Formula/crust.rb`;
	await sh(["git", "fetch", TAP_REMOTE], TAP_DIR, gitEnv);
	await sh(["git", "checkout", "-q", "-B", `crust-${version}`, `${TAP_REMOTE}/main`], TAP_DIR);
	const text = await Bun.file(formula).text();
	const bumped = bumpFormula(text, version, { source: sha, linux });
	await Bun.write(formula, bumped);
	await sh(["git", "add", "Formula/crust.rb"], TAP_DIR);
	await sh(
		[
			"git",
			"-c",
			"user.name=jyzbot",
			"-c",
			"user.email=jyz-agent@botmail.pro",
			"commit",
			"-q",
			"-m",
			`feat: crust ${version}`,
		],
		TAP_DIR,
	);
	await sh(["git", "push", TAP_REMOTE, `crust-${version}`], TAP_DIR, gitEnv);
	const body = `${TAP_DIR}/.crust-${version}.md`;
	await Bun.write(body, tapPrBody(version, sha, linux));
	try {
		return await sh([
			"gh",
			"pr",
			"create",
			"--repo",
			"JeffreyJYZ/homebrew-tap",
			"--base",
			"main",
			"--head",
			`crust-${version}`,
			"--title",
			`feat: crust ${version}`,
			"--body-file",
			body,
		]);
	} finally {
		await sh(["rm", body]);
	}
}
