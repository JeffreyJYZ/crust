/**
 * The release workflow's safety property: a release is not public until every build leg
 * and the asset verifier passed. A failed matrix leg must never leave "Latest" holding a
 * subset of the binaries — the workflow is the only place that invariant can be enforced.
 */
import { expect, test } from "bun:test";
import { bumpFormula, tapPrBody } from "./formula.ts";
import { parseLinuxDigests, waitForLinuxDigests } from "./linux-assets.ts";

const source = await Bun.file(
	new URL("../../.github/workflows/release.yml", import.meta.url),
).text();

/** One job block, from its 4-space `name:` header to the next job header. */
function job(name: string): string {
	const start = source.indexOf(`    ${name}:\n`);
	if (start < 0) return "";
	const rest = source.slice(start + 1);
	const next = /\n    [^\s]/.exec(rest);
	return next === null ? rest : rest.slice(0, next.index);
}

test("creation makes a draft, never a public Latest", () => {
	expect(job("create-release")).toContain("--draft");
});

test("a publish job alone makes the release public, and only after build and verify", () => {
	const publish = job("publish");
	expect(publish).toContain("gh release edit");
	expect(publish).toContain("--draft=false");
	expect(publish).toMatch(/needs:\s*\[create-release, build, verify\]/);
	// No `if`: GitHub skips a job whose needs did not all succeed.
	expect(publish).not.toMatch(/^\s+if:/m);
});

test("the build matrix ships a Windows arm64 asset on a native arm runner", () => {
	const build = job("build");
	expect(build).toContain("- target: bun-windows-arm64");
	expect(build).toContain("runner: windows-11-arm");
	// windows-latest is x64: a cross-compile there would only SKIP the run-and-prove half.
	expect(build).not.toMatch(/bun-windows-arm64\s*\n\s*runner: windows-latest/);
});

test("the verifier runs even when a build leg failed, and the failure is flagged", () => {
	expect(job("verify")).toMatch(/needs:\s*\[create-release, build\]/);
	expect(job("verify")).toContain("always()");
	const flag = job("flag-failed");
	expect(flag).toContain("FAILED BUILD");
	expect(flag).toContain("--draft");
});

// ---- The tap PR must be written after the tag's Linux assets exist ---------

const release = await Bun.file(new URL("../release.ts", import.meta.url)).text();

test("the release waits for the Linux assets after push and before the tap PR", () => {
	const at = (needle: string) => release.indexOf(needle);
	const push = at('step("push", `main and ${tag}`)');
	const wait = at("linux = await waitForLinuxDigests({");
	const digest = at("// ---- 6. Tarball digest");
	const pr = at("url = await openTapPr(version, sha, linux)");
	expect(Math.min(push, wait, digest, pr)).toBeGreaterThan(-1);
	expect(push).toBeLessThan(wait);
	expect(wait).toBeLessThan(digest);
	expect(digest).toBeLessThan(pr);
	// The old PR body told a human to refresh hashes; there is no such step left.
	expect(release).not.toContain("must be refreshed");
	expect(release).not.toContain("Replace both");
});

test("--dry prints the same order the script follows", () => {
	const plan = release.indexOf("const STEP_ORDER = [");
	expect(plan).toBeGreaterThan(-1);
	let cursor = plan;
	for (const item of [
		"gate",
		"push main and tag",
		"wait for the tag's Linux assets and read their digests",
		"tarball digest",
		"write formula and open one tap PR",
	]) {
		const next = release.indexOf(`"${item}"`, cursor);
		expect(next).toBeGreaterThan(cursor);
		cursor = next;
	}
});

const arm = "a".repeat(64);
const x64 = "b".repeat(64);
const sourceSha = "c".repeat(64);
const tsv = `crust-0.2.24-linux-arm64\tsha256:${arm}\ncrust-0.2.24-linux-x64\tsha256:${x64}\n`;

test("only this version's GitHub digests are accepted", () => {
	expect(parseLinuxDigests(tsv, "0.2.24")).toEqual({ arm64: arm, x64 });
	expect(parseLinuxDigests(tsv, "0.2.23")).toEqual({});
	expect(parseLinuxDigests(`crust-0.2.24-linux-x64\t${x64}`, "0.2.24")).toEqual({});
});

test("the poll waits for both assets and reports why on every attempt", async () => {
	const notes: string[] = [];
	let calls = 0;
	const got = await waitForLinuxDigests({
		tag: "v0.2.24",
		version: "0.2.24",
		attempts: 3,
		delayMs: 0,
		note: (detail) => notes.push(detail),
		look: async () => {
			calls++;
			return calls === 1 ? `crust-0.2.24-linux-arm64\tsha256:${arm}` : tsv;
		},
	});
	expect(got).toEqual({ arm64: arm, x64 });
	expect(calls).toBe(2);
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain("crust-0.2.24-linux-x64");
	expect(notes[0]).toContain("v0.2.24 tag push");
});

test("a bounded wait fails clearly rather than opening a PR with stale hashes", async () => {
	await expect(
		waitForLinuxDigests({
			tag: "v0.2.24",
			version: "0.2.24",
			attempts: 2,
			delayMs: 0,
			look: async () => "",
		}),
	).rejects.toThrow(/did not appear after 2 attempts[\s\S]*no tap PR was opened/);
});

const fixture = `class Crust < Formula
  on_macos do
    url "https://github.com/JeffreyJYZ/crust/archive/refs/tags/v0.2.23.tar.gz"
    sha256 "${"0".repeat(64)}"
  end
  on_linux do
    on_arm do
      url "https://github.com/JeffreyJYZ/crust/releases/download/v0.2.23/crust-0.2.23-linux-arm64"
      sha256 "${"1".repeat(64)}"
    end
    on_intel do
      url "https://github.com/JeffreyJYZ/crust/releases/download/v0.2.23/crust-0.2.23-linux-x64"
      sha256 "${"2".repeat(64)}"
    end
  end
  def install
    asset = "crust-#{version}-linux-#{Hardware::CPU.arm? ? "arm64" : "x64"}"
    bin.install asset => "crust"
    chmod 0755, bin/"crust"
  end
  test do
    assert_match "0.2.23", shell_output("#{bin}/crust --version")
  end
end`;

test("the formula bump moves all three hashes and both Linux URLs, not the install shape", () => {
	const out = bumpFormula(fixture, "0.2.24", {
		source: sourceSha,
		linux: { arm64: arm, x64 },
	});
	expect(out.match(/sha256 "[0-9a-f]{64}"/g)).toHaveLength(3);
	expect(out).toContain(`sha256 "${sourceSha}"`);
	expect(out).toContain(`sha256 "${arm}"`);
	expect(out).toContain(`sha256 "${x64}"`);
	expect(out).not.toContain("v0.2.23");
	expect(out).toContain("crust-0.2.24-linux-arm64");
	expect(out).toContain("crust-0.2.24-linux-x64");
	expect(out).toContain('assert_match "0.2.24", shell_output("#{bin}/crust --version")');
	expect(out).toContain('bin.install asset => "crust"');
	expect(out).toContain('chmod 0755, bin/"crust"');
	expect(() =>
		bumpFormula("not a formula", "0.2.24", { source: sourceSha, linux: { arm64: arm, x64 } }),
	).toThrow(/shape changed/);
});

test("the PR body explains the ordering and asks for no manual hash refresh", () => {
	const body = tapPrBody("0.2.24", sourceSha, { arm64: arm, x64 });
	expect(body).toContain(arm);
	expect(body).toContain(x64);
	expect(body).toContain("No manual refresh is needed before merge");
	expect(body).toContain("draft");
	expect(body).not.toMatch(/must be refreshed|Replace both/i);
});
