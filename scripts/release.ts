#!/usr/bin/env bun
/**
 * Cut a release: bump, gate, tag, push, open the tap PR. Hand-releasing is where the mistakes were — a tag pushed before the version bump (v0.1.2 pointed at a tree still saying 0.1.1), a formula pinned to a tag predating its own fixes, three PRs for one afternoon of work.
 * Needs a clean tree on `main` and the `gh` identity that may push the tap branch (jyzbot). It does not merge: tap `main` is protected and the review is the point. Shell in `release/git.ts`, gate in `release/gate.ts`.
 */
import { bumpFormula, tapPrBody } from "./release/formula.ts";
import { gate } from "./release/gate.ts";
import { fail, failureCount, gitEnv, nextVersion, REMOTE, REPO, sh, step } from "./release/git.ts";
import {
	type LinuxDigests,
	RELEASE_ASSETS_QUERY,
	waitForLinuxDigests,
} from "./release/linux-assets.ts";
import { openTapPr } from "./release/tap.ts";

/** Printed by `--dry` and pinned by the release tests; the code below follows this order. */
const STEP_ORDER = [
	"gate",
	"bump, commit, tag",
	"push main and tag",
	"wait for the tag's Linux assets and read their digests",
	"tarball digest",
	"write formula and open one tap PR",
];

const args = Bun.argv.slice(2);
const dry = args.includes("--dry");
const level = args.includes("--minor") ? "minor" : args.includes("--major") ? "major" : "patch";

// ---- 1. Preconditions ------------------------------------------------------
const dirty = await sh(["git", "status", "--porcelain"]);
if (dirty.length > 0) {
	fail("clean", `working tree is not clean:\n${dirty}`);
	process.exit(1);
}
const branch = await sh(["git", "branch", "--show-current"]);
if (branch !== "main") {
	fail("branch", `on ${branch || "(detached)"}, not main`);
	process.exit(1);
}

const manifest = (await Bun.file(`${REPO}/package.json`).json()) as {
	version: string;
};
const version = nextVersion(manifest.version, level);
const tag = `v${version}`;
step("release", `${manifest.version} -> ${version} (${tag})`);

if (dry) {
	step("dry", "stopping before any write; planned order:");
	for (const item of STEP_ORDER) step("plan", item);
	process.exit(0);
}

// ---- 2. Gate ---------------------------------------------------------------
await gate();
if (failureCount() > 0) process.exit(1);

// ---- 3. Bump, commit, tag --------------------------------------------------
await Bun.write(
	`${REPO}/package.json`,
	`${JSON.stringify({ ...manifest, version }, null, "\t")}\n`,
);
// Install examples pin the tag, so README's and SKILL.md's commands move with it. The docs site is
// deliberately excluded: its pages state *measured* answers — what bunx returned for a tag
// on a fresh cache — and rewriting a tag there pairs a new tag with an old measurement,
// which is how 0.1.9 shipped a table claiming #v0.1.9 answers 0.1.8. Re-measure by hand
// (`BUN_INSTALL=<tmp> bunx …#<tag> --version`) and edit the install page. SKILL.md's quickstart
// claims nothing about what the tag answers, so it moves with the tag like README; the
// install page is the only pin left to a human.
for (const path of [`${REPO}/README.md`, `${REPO}/site/public/SKILL.md`]) {
	const text = await Bun.file(path).text();
	const updated = text.replaceAll(`#v${manifest.version}`, `#${tag}`);
	if (updated !== text) await Bun.write(path, updated);
	step("pins", `${path.slice(REPO.length + 1)}${updated === text ? " (no change)" : ""}`);
}
await sh(["git", "add", "package.json", "README.md", "site/public/SKILL.md"]);
console.log("  note      re-measure the bunx tag in site/app/docs/start/install for this tag");
await sh([
	"git",
	"-c",
	"user.name=jyzbot",
	"-c",
	"user.email=jyz-agent@botmail.pro",
	"commit",
	"-q",
	"-m",
	`chore: ${version}`,
]);
await sh(["git", "tag", "-a", tag, "-m", `crust ${version}`]);
step("tag", tag);

// ---- 4. Push ---------------------------------------------------------------
await sh(["git", "push", REMOTE, "main", tag], REPO, gitEnv);
step("push", `main and ${tag}`);

// ---- 5. Linux assets -------------------------------------------------------
// CI creates the release on the tag push and uploads the binaries after it. Wait for
// both here and read GitHub's own digests: opening the PR first and asking a human to
// refresh the hashes shipped formulas whose Linux sha256 named the previous release.
let linux: LinuxDigests;
try {
	linux = await waitForLinuxDigests({
		tag,
		version,
		note: (detail) => step("assets", detail),
		look: () =>
			sh(
				[
					"gh",
					"release",
					"view",
					tag,
					"--repo",
					"JeffreyJYZ/crust",
					"--json",
					"assets",
					"-q",
					RELEASE_ASSETS_QUERY,
				],
				REPO,
				gitEnv,
			),
	});
	step("assets", `arm64 ${linux.arm64}; x64 ${linux.x64}`);
} catch (error) {
	fail("assets", error instanceof Error ? error.message : String(error));
	process.exit(1);
}

// ---- 6. Tarball digest -----------------------------------------------------
// GitHub serves an archive a moment after the tag lands, and a 404 here would bake a
// wrong checksum into the formula, so this retries rather than guessing.
let sha = "";
for (let attempt = 0; attempt < 10 && sha === ""; attempt++) {
	const response = await fetch(
		`https://github.com/JeffreyJYZ/crust/archive/refs/tags/${tag}.tar.gz`,
	);
	if (response.ok) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	} else await Bun.sleep(1500);
}
if (sha === "") {
	fail("digest", `could not fetch the ${tag} archive`);
	process.exit(1);
}
step("digest", sha);

// ---- 7. Formula and PR -----------------------------------------------------
// Both digests are known now, so the PR opens once with a correct formula.
let url: string;
try {
	url = await openTapPr(version, sha, linux);
} catch (error) {
	fail("formula", error instanceof Error ? error.message : String(error));
	process.exit(1);
}
step("pr", url);

console.log(`\nrelease: ${version} tagged and pushed; merge the tap PR to deliver it.`);
