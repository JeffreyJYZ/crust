/**
 * The release workflow's safety property: a release is not public until every build leg
 * and the asset verifier passed. A failed matrix leg must never leave "Latest" holding a
 * subset of the binaries — the workflow is the only place that invariant can be enforced.
 */
import { expect, test } from "bun:test";

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
