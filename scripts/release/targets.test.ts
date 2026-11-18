/**
 * The mapping from this machine to a release target, which is the one place the names can
 * disagree: `process.platform` says `win32` while the table says `bun-windows-x64`. That
 * mismatch is not theoretical — a release job passing `--target bun-windows-x64` died on
 * "no release target for win32-x64" before compiling anything, while the same script was
 * fine on darwin and linux because those two names happen to line up (2026-11-17).
 */
import { describe, expect, test } from "bun:test";
import { artifactName, hostTarget, TARGETS, VERSION } from "./targets.ts";

/** Override the two process facts `hostTarget` reads, restoring them even if an expect throws. */
function withHost(platform: string, arch: string, check: () => void): void {
	const realPlatform = process.platform;
	const realArch = process.arch;
	try {
		Object.defineProperty(process, "platform", { value: platform, configurable: true });
		Object.defineProperty(process, "arch", { value: arch, configurable: true });
		check();
	} finally {
		Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
		Object.defineProperty(process, "arch", { value: realArch, configurable: true });
	}
}

describe("hostTarget", () => {
	test("names a target for this platform and arch", () => {
		const host = hostTarget();
		expect(host).toBeDefined();
		expect(Object.keys(TARGETS)).toContain(host as string);
	});

	test("win32 is spelled windows, the way the table spells it", () => {
		// The whole bug: `bun-win32-x64` is not a key, `bun-windows-x64` is. The expected values are
		// literals: rebuilding them with `hostTarget`'s own conditional let this test pass on darwin
		// and linux runners without ever evaluating the win32 arm (2026-11-18).
		const cases = [
			["win32", "x64", "bun-windows-x64"],
			["win32", "arm64", "bun-windows-arm64"],
			["darwin", "arm64", "bun-darwin-arm64"],
			["linux", "x64", "bun-linux-x64"],
		] as const;
		for (const [platform, arch, expected] of cases) {
			withHost(platform, arch, () => {
				expect(hostTarget()).toBe(expected);
			});
		}
	});

	test("every target is a key this platform could plausibly answer", () => {
		for (const target of Object.keys(TARGETS)) {
			expect(target.startsWith("bun-")).toBe(true);
			expect(target).not.toContain("win32");
		}
	});
});

describe("the target table", () => {
	test("covers six targets, including a Windows arm64 one", () => {
		const keys = Object.keys(TARGETS);
		expect(keys).toHaveLength(6);
		expect(keys).toContain("bun-windows-arm64");
		expect(TARGETS["bun-windows-arm64"]).toEqual({
			os: "windows",
			arch: "arm64",
			magic: ["4d5a"],
		});
	});

	test("every Windows target is a PE image, arm64 magic included", () => {
		// Literals, not borrowed from TARGETS: the magic is what a verifier checks on a
		// binary this machine cannot execute, so a typo here would be invisible elsewhere.
		expect(TARGETS["bun-windows-x64"].magic).toEqual(["4d5a"]);
		expect(TARGETS["bun-windows-arm64"].magic).toEqual(["4d5a"]);
	});
});

describe("artifactName", () => {
	test("carries the version, the os and the arch", () => {
		expect(artifactName("bun-linux-arm64")).toBe(`crust-${VERSION}-linux-arm64`);
		expect(artifactName("bun-darwin-x64")).toBe(`crust-${VERSION}-darwin-x64`);
	});

	test("windows carries an .exe suffix and nothing else does", () => {
		expect(artifactName("bun-windows-x64")).toBe(`crust-${VERSION}-windows-x64.exe`);
		expect(artifactName("bun-windows-arm64")).toBe(`crust-${VERSION}-windows-arm64.exe`);
		for (const target of ["bun-darwin-arm64", "bun-linux-x64"] as const) {
			expect(artifactName(target).endsWith(".exe")).toBe(false);
		}
	});

	test("the version comes from package.json, never a literal", () => {
		expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(artifactName("bun-linux-x64")).toContain(VERSION);
	});
});
