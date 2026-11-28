/**
 * Tap-formula bump for a release. Three hashes move together: the macOS source archive and
 * the two Linux assets. URLs follow the tag; the `on_linux` block's shape (on_arm/on_intel,
 * `bin.install … => "crust"`, `chmod 0755`) is deliberately untouched.
 */
import type { LinuxDigests } from "./linux-assets.ts";

export interface FormulaDigests {
	source: string;
	linux: LinuxDigests;
}

function replaceHash(text: string, block: "macos" | "arm" | "intel", hash: string): string {
	const pair = new RegExp(
		`(on_${block} do\\s*\\n\\s*url "[^"]+"\\s*\\n\\s*sha256 ")[0-9a-f]{64}(")`,
	);
	const at = pair.exec(text);
	if (!at) throw new Error(`formula shape changed: ${block} url/sha256 pair not found`);
	return `${text.slice(0, at.index)}${at[1]}${hash}${at[2]}${text.slice(at.index + at[0].length)}`;
}

function replaceUrls(text: string, version: string): string {
	const archive = /refs\/tags\/v[0-9.]+\.tar\.gz/g;
	const assets = /releases\/download\/v[0-9.]+\/crust-[0-9.]+-linux-/g;
	const replacement = `refs/tags/v${version}.tar.gz`;
	const assetReplacement = `releases/download/v${version}/crust-${version}-linux-`;
	if (text.search(archive) < 0 || text.search(assets) < 0)
		throw new Error("formula shape changed: source archive or Linux asset URL not found");
	return text.replace(archive, replacement).replace(assets, assetReplacement);
}

function replaceAssertion(text: string, version: string): string {
	const pattern =
		/assert_match "[0-9]+\.[0-9]+\.[0-9]+", shell_output\("#\{bin\}\/crust --version"\)/;
	if (text.search(pattern) < 0)
		throw new Error("formula shape changed: version assertion not found");
	return text.replace(
		pattern,
		`assert_match "${version}", shell_output("#{bin}/crust --version")`,
	);
}

export function bumpFormula(text: string, version: string, digests: FormulaDigests): string {
	let out = replaceHash(text, "macos", digests.source);
	out = replaceHash(out, "arm", digests.linux.arm64);
	out = replaceHash(out, "intel", digests.linux.x64);
	out = replaceUrls(out, version);
	out = replaceAssertion(out, version);
	if (out === text) throw new Error("formula unchanged");
	return out;
}

/** The PR describes the ordering choice; it never asks a human to fix a hash by hand. */
export function tapPrBody(version: string, sha: string, linux: LinuxDigests): string {
	return `Bumps crust to ${version}.

Source formula on macOS, unchanged in shape: crust is TypeScript Bun runs, and its
runtime compiles the bundled C shim at launch with the TinyCC inside Bun, so there is
nothing to build or bottle. Linux installs the standalone binary attached to the tag.

Written once, after waiting for both Linux assets on the ${version} release. CI creates the
release as a draft on the tag push, six build jobs upload the binaries, the verifier runs,
and only then is the release published. The tap PR is not an input to that workflow, so
waiting cannot stall CI. Both Linux digests come from GitHub's own \`digest\` field on those
assets, and the URLs name the same tag: arm64 \`${linux.arm64}\`, x64 \`${linux.x64}\`.
No manual refresh is needed before merge; a stale digest would make \`brew install\` fail
with a checksum error, which is why the PR opens only once, with correct hashes.

If a Linux build leg fails, CI flags the draft FAILED BUILD, the wait expires with a clear
error, and no tap PR opens. The tag is already cut, so nothing about the release itself is
lost by waiting.

Updated from the tagged archive: \`v${version}\`, sha256 \`${sha}\`. The formula test now
expects \`crust --version\` to print \`${version}\`.

Upstream gate at the tag: \`bun check\`, the unit suite, and the e2e suites — see the tag
message and the repo's CI run for this commit.
`;
}
