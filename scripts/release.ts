#!/usr/bin/env bun
/**
 * Cut a release: bump, gate, tag, push, open the tap PR. Hand-releasing is where the mistakes were — a tag pushed before the version bump (v0.1.2 pointed at a tree still saying 0.1.1), a formula pinned to a tag predating its own fixes, three PRs for one afternoon of work.
 * Needs a clean tree on `main` and the `gh` identity that may push the tap branch (jyzbot). It does not merge: tap `main` is protected and the review is the point. Shell in `release/git.ts`, gate in `release/gate.ts`.
 */
import { gate } from "./release/gate.ts";
import {
	fail,
	failureCount,
	gitEnv,
	nextVersion,
	REPO,
	REMOTE,
	sh,
	step,
	TAP_DIR,
	TAP_REMOTE,
} from "./release/git.ts";

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

const manifest = (await Bun.file(`${REPO}/package.json`).json()) as { version: string };
const version = nextVersion(manifest.version, level);
const tag = `v${version}`;
step("release", `${manifest.version} -> ${version} (${tag})`);

if (dry) {
	step("dry", "stopping before any write");
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
// Install examples pin the tag, so README's commands move with it. docs/install.md is
// deliberately excluded: it carries *measured* answers — what bunx returned for a tag on a
// fresh cache, what a stale cache returned — and rewriting the tag there pairs a new tag
// with an old measurement, which is how 0.1.9 shipped a table claiming #v0.1.9 answers
// 0.1.8. Re-measure that page by hand instead (`BUN_INSTALL=<tmp> bunx …#<tag> --version`).
{
	const path = `${REPO}/README.md`;
	const text = await Bun.file(path).text();
	const updated = text.replaceAll(`#v${manifest.version}`, `#${tag}`);
	if (updated !== text) await Bun.write(path, updated);
	step("pins", `README.md${updated === text ? " (no change)" : ""}`);
}
await sh(["git", "add", "package.json", "README.md"]);
console.log("  note      re-measure the bunx table in docs/install.md for this tag");
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

// ---- 5. Tarball digest -----------------------------------------------------
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

// ---- 6. Formula and PR -----------------------------------------------------
const formula = `${TAP_DIR}/Formula/crust.rb`;
await sh(["git", "fetch", TAP_REMOTE], TAP_DIR, gitEnv);
await sh(["git", "checkout", "-q", "-B", `crust-${version}`, `${TAP_REMOTE}/main`], TAP_DIR);
const text = await Bun.file(formula).text();
const bumped = text
	.replace(/refs\/tags\/v[0-9.]+\.tar\.gz/, `refs/tags/${tag}.tar.gz`)
	.replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${sha}"`)
	.replace(
		/assert_match "0\.[0-9.]+", shell_output\("#\{bin\}\/crust --version"\)/,
		`assert_match "${version}", shell_output("#{bin}/crust --version")`,
	);
if (bumped === text) {
	fail("formula", `no version, digest or assertion changed in ${formula}`);
	process.exit(1);
}
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
await Bun.write(
	body,
	`Bumps crust to ${version}.\n\nSource formula, unchanged in shape: crust is TypeScript Bun runs, and its runtime\ncompiles the bundled C shim at launch with the TinyCC inside Bun, so there is nothing to\nbuild or bottle.\n\nUpdated from the tagged archive: \`${tag}\`, sha256 \`${sha}\`, and the formula test now\nexpects \`crust --version\` to print \`${version}\`.\n\nUpstream gate at the tag: \`bun check\`, the unit suite, and the e2e suites — see the tag\nmessage and the repo's CI run for this commit.\n`,
);
const url = await sh([
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
await sh(["rm", body]);
step("pr", url);

console.log(`\nrelease: ${version} tagged and pushed; merge the tap PR to deliver it.`);
