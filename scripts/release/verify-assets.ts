#!/usr/bin/env bun
/**
 * Verify the assets a release tag actually published, not the ones it should have: every
 * expected `crust-<version>-<os>-<arch>` is downloaded from the GitHub Release, checked for
 * a plausible size and the right executable container, and — only for this machine's own
 * platform — executed to read `crust --version`.
 *
 * Why this is a second script beside `scripts/verify-release.ts`: that one reads a *locally
 * built macOS `.app`* — plist keys, an ad-hoc signature, a quarantine attribute — and never
 * touches the network. This one reads *published release assets* on any OS, never touches a
 * bundle, and cannot judge a signature. Two artefacts, two failure modes, two runners;
 * overloading one script would make both lie about what they checked.
 *
 *   bun run scripts/release/verify-assets.ts v0.1.22 [--dir <path>]
 *
 * Needs `gh` on PATH with `GH_TOKEN` (or a logged-in `gh`) to list and download. One verdict
 * line, non-zero exit listing every gap, and every gap names the tag.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attached, checkAsset, download, gh, repo } from "./assets.ts";
import { artifactName, hostTarget, TARGETS, type Target, VERSION } from "./targets.ts";

interface Args {
	tag?: string;
	dir?: string;
	error?: string;
}

function parse(argv: string[]): Args {
	const args: Args = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (arg === "--dir") {
			const value = argv[++index];
			if (value === undefined || value.startsWith("--"))
				return { error: "--dir needs a path" };
			args.dir = value;
		} else if (arg.startsWith("--")) return { error: `unknown option ${arg}` };
		else args.tag = arg;
	}
	if (args.tag === undefined) return { error: "usage: verify-assets.ts <tag> [--dir <path>]" };
	return args;
}

async function main(): Promise<number> {
	const args = parse(Bun.argv.slice(2));
	const tag = args.tag;
	if (args.error !== undefined || tag === undefined) {
		console.log(`verify-assets: FAIL  ${args.error ?? "no tag"}`);
		return 1;
	}

	// The assets embed the version, so a tag that disagrees with package.json would publish
	// binaries whose own `--version` answers something else. That is a release-wide defect,
	// not a per-asset one, and it is named before anything is downloaded.
	const expected = `v${VERSION}`;
	if (tag !== expected) {
		console.log(
			`verify-assets: FAIL  ${tag} does not name package.json's version (${expected}); ` +
				"the assets would be built from a different tree than the tag",
		);
		return 1;
	}

	const where = repo();
	if (where === "") {
		console.log(
			`verify-assets: FAIL  ${tag}  no repository: set GITHUB_REPOSITORY or run inside a clone`,
		);
		return 1;
	}

	const keys = Object.keys(TARGETS) as Target[];
	const names = keys.map(artifactName);
	const dir = args.dir ?? (await mkdtemp(join(tmpdir(), "crust-release-")));
	const gaps: Array<{ what: string; detail: string }> = [];

	// ---- what the release says it has ---------------------------------------
	const listed = attached(tag, where);
	if (listed.gap) gaps.push(listed.gap);
	const missing = new Set<string>();
	for (const name of names) {
		if (listed.gap === undefined && !listed.names.includes(name)) {
			missing.add(name);
			gaps.push({ what: "missing", detail: `${tag} has no asset named ${name}` });
		}
	}

	// ---- the bytes ----------------------------------------------------------
	const failed = download(tag, where, dir);
	if (failed) gaps.push(failed);

	const host = hostTarget();
	let bytes = 0;
	try {
		// A failed download means there are no bytes to judge; the download line above is
		// the finding, and five "absent" lines would only bury it.
		for (const key of failed ? [] : keys) {
			// Already named above: a second line saying it also failed to download is the
			// same gap twice, and it buries the first.
			if (missing.has(artifactName(key))) continue;
			const checked = await checkAsset(key, dir, host);
			bytes += checked.bytes;
			for (const line of checked.lines) console.log(line);
			gaps.push(...checked.gaps);
		}
	} finally {
		if (args.dir === undefined) await rm(dir, { recursive: true, force: true });
	}

	if (gaps.length > 0) {
		for (const gap of gaps) console.log(`  ${gap.what.padEnd(10)}${gap.detail}`);
		console.log(`verify-assets: FAIL  ${tag}  ${gaps.length} gap(s)`);
		return 1;
	}

	console.log(
		`verify-assets: PASS  ${tag}  ${names.length} assets  ${(bytes / 1_048_576).toFixed(1)} MiB  ` +
			`executed ${host ?? "nothing (unsupported platform)"}`,
	);
	return 0;
}

try {
	process.exit(await main());
} catch (error) {
	// A missing argument or an unreachable release is still a verdict, not a stack trace.
	console.log(`verify-assets: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
